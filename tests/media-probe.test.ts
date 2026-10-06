import { createExecutionContext } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import api from "../src/server/api";
import { assetFile, deleteAsset } from "../src/server/media/assets";
import { normalizeMedia } from "../src/server/media/catalog";
import {
  createImageDriver,
  imageAdapterReady,
} from "../src/server/media/image-driver";
import { getMediaRequest, reserveMedia } from "../src/server/media/ledger";
import type { MediaEnv } from "../src/server/media/policy";
import {
  diagnoseProbeAcl,
  observeProbeExpiry,
  observeProbeToken,
} from "../src/server/media/probe-diagnostics";
import {
  assertProbePermit,
  authorizeMediaProbe,
  beforeProbeSubmit,
  claimProbeDispatch,
  closeMediaProbe,
  PROBE_APPROVAL_VERSION,
  PROBE_CLOCK,
  probeInput,
  readProbeRun,
  reserveProbeCall,
  stopMediaProbe,
} from "../src/server/media/probe-permit";
import { handleMediaProbe } from "../src/server/media/probe-routes";
import {
  blockMediaRecovery,
  eraseMediaBody,
  maintainMediaRetention,
  readMediaRecoveryWitness,
  reconcileMediaRecovery,
} from "../src/server/media/retention";
import {
  advanceMediaJob,
  inputHash,
  listMediaJobs,
  resumeMediaCollection,
  submitMedia,
} from "../src/server/media/service";
import {
  allowNextMediaPoll,
  MEDIA_DATABASE as DATABASE,
  MEDIA_ENV,
  resetMediaDatabase,
} from "./media-fixtures";
import { createMediaIntegrationFake } from "./media-integration-fake";

const ORIGIN = "https://probe.example.test";
const IDENTITY = {
  id: "access:example-probe.cloudflareaccess.com:fixture-subject",
  email: "probe@example.test",
  name: "TEST_ONLY",
};
const CONFIGURATION: MediaEnv = {
  ...MEDIA_ENV,
  APP_ENV: "staging",
  STAGING_POLICY: "standard",
  AUTH_MODE: "access",
  APP_ORIGIN: ORIGIN,
  LOCAL_DEMO: "false",
  AI_MODE: "off",
  AI_ALLOWED_MODELS: "[]",
  JEV_MODE: "off",
  ENABLE_MEDIA: "false",
  MEDIA_ALLOWED_MODELS: "[]",
  MEDIA_VERIFIED_IMAGE_MODELS: "[]",
  MEDIA_VERIFIED_VIDEO_MODELS: "[]",
  MEDIA_VERIFIED_AUDIO_MODELS: "[]",
  ENABLE_IMAGES: "false",
  ENABLE_RAG: "false",
  ENABLE_AGENT: "false",
  ENABLE_WORKFLOWS: "false",
  ENABLE_BILLING: "false",
  ENABLE_MEDIA_PROBE: "true",
  MEDIA_PROBE_APPROVAL_VERSION: PROBE_APPROVAL_VERSION,
  ACCESS_TEAM_DOMAIN: "example-probe.cloudflareaccess.com",
  ACCESS_AUD: "TEST_ONLY_probe_audience",
};
let requestKey: string;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let keySet: { keys: Awaited<ReturnType<typeof exportJWK>>[] };
beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
  keySet = {
    keys: [
      {
        ...(await exportJWK(keys.publicKey)),
        kid: "TEST_ONLY_probe",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
});
beforeEach(async () => {
  await DATABASE.batch(
    [
      "media_probe_evidence",
      "media_probe_calls",
      "media_probe_output",
      "media_probe_attempts",
      "media_probe_slots",
      "media_probe_run",
    ].map((table) => DATABASE.prepare(`DELETE FROM ${table}`)),
  );
  await resetMediaDatabase();
  requestKey = `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function register(options: { offset?: number; origin?: string } = {}) {
  const row = await DATABASE.prepare(`SELECT ${PROBE_CLOCK} AS now`).first<{
    now: number;
  }>();
  const start = (row?.now ?? Date.now()) + (options.offset ?? -1000);
  await DATABASE.prepare(
    "INSERT INTO media_probe_run(id,approval_version,owner_id,app_origin,started_at,expires_at) VALUES(1,?,?,?,?,?)",
  )
    .bind(
      PROBE_APPROVAL_VERSION,
      IDENTITY.id,
      options.origin ?? ORIGIN,
      start,
      start + 1800000,
    )
    .run();
  await DATABASE.prepare("INSERT INTO media_probe_slots VALUES(1,1,?,?)")
    .bind(requestKey, await inputHash(normalizeMedia(probeInput(requestKey))))
    .run();
}
function request(path: string, method = "GET", body?: unknown) {
  return new Request(ORIGIN + path, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function installFake(options: { hasUnknownSubmission?: boolean } = {}) {
  const fake = createMediaIntegrationFake(() => CONFIGURATION, options);
  const transport: typeof fetch = async (resource, initialization) => {
    if (initialization?.redirect !== "manual")
      throw new Error("TEST_ONLY_e_redirect_contract");
    return fake.transport(resource, { ...initialization, redirect: "error" });
  };
  vi.stubGlobal("fetch", transport);
  return { ...fake, transport };
}
async function submit() {
  const response = await handleMediaProbe(
    request("/api/media-probe/jobs", "POST", {
      slot: 1,
      requestId: requestKey,
    }),
    CONFIGURATION,
    IDENTITY,
  );
  expect(response.status).toBe(202);
  return (await response.json()) as { id: string };
}
async function complete() {
  const job = await submit();
  await allowNextMediaPoll(job.id);
  const response = await handleMediaProbe(
    request(`/api/media-probe/jobs/${job.id}/refresh`, "POST", {}),
    CONFIGURATION,
    IDENTITY,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ terminalOutcome: "stored" });
  return job;
}
async function permitFor(jobId: string) {
  return authorizeMediaProbe(CONFIGURATION, IDENTITY, requestKey, jobId);
}
async function assertion(subject = "fixture-subject") {
  return new SignJWT({ sub: subject, email: "probe@example.test", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "TEST_ONLY_probe" })
    .setIssuer("https://example-probe.cloudflareaccess.com")
    .setAudience(CONFIGURATION.ACCESS_AUD ?? "")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keys.privateKey);
}
async function authenticatedCall(
  path: string,
  method = "GET",
  body?: unknown,
  subject = "fixture-subject",
  configuration = CONFIGURATION,
) {
  const incoming = request(path, method, body);
  incoming.headers.set("cf-access-jwt-assertion", await assertion(subject));
  return api.fetch(incoming, configuration, createExecutionContext());
}
describe("工程E fixed synthetic probe in workerd/D1/private R2", () => {
  it("sends only the adopted immutable input, leaves usual gates empty and collects after admission stops", async () => {
    await register();
    const fake = installFake();
    const job = await complete();
    expect(fake.submissions).toHaveLength(1);
    expect(fake.submissions[0]).toMatchObject({
      model: "openai/gpt-image-2.5/sunburst/text-to-image",
      input: {
        image_size: { width: 1024, height: 1024 },
        quality: "medium",
        num_images: 1,
        background: "opaque",
        output_format: "png",
        sync_mode: false,
      },
    });
    expect(fake.submissions[0].input.prompt).toBe(
      "架空のWebページ用の画像。白い背景に、青い陶器の立方体、黄色い紙の円柱、緑のガラス球を並べた静物。柔らかな斜光、中央に三つの形、周囲に十分な余白。文字、人、ロゴ、実在の商品や建物は描かない。",
    );
    expect(
      imageAdapterReady(
        CONFIGURATION,
        "openai/gpt-image-2.5/sunburst/text-to-image",
      ),
    ).toBe(false);
    expect(await readProbeRun(CONFIGURATION, IDENTITY.id)).toMatchObject({
      used_attempts: 1,
      is_stopped: 1,
      max_attempts: 2,
    });
    const detail = (await (
      await handleMediaProbe(
        request("/api/media-probe"),
        CONFIGURATION,
        IDENTITY,
      )
    ).json()) as { job: { assets: { id: string }[] } };
    expect(detail.job.assets).toHaveLength(1);
    expect(
      await (
        await assetFile(
          request("/file"),
          CONFIGURATION,
          IDENTITY,
          detail.job.assets[0].id,
        )
      ).arrayBuffer(),
    ).toBeTruthy();
    const replay = await submit();
    expect(replay.id).toBe(job.id);
    expect(fake.submissions).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain("v3b.fal.media");
    expect(JSON.stringify(detail)).not.toContain("TEST_ONLY_m5_cdn_token");
  });
  it("parallel tabs and replay consume one persistent slot and one provider POST", async () => {
    await register();
    const fake = installFake();
    const calls = await Promise.allSettled([submit(), submit(), submit()]);
    expect(calls.some((call) => call.status === "fulfilled")).toBe(true);
    expect(fake.submissions).toHaveLength(1);
    expect(
      await DATABASE.prepare(
        "SELECT count(*) AS n FROM media_probe_attempts",
      ).first(),
    ).toEqual({ n: 1 });
    expect(
      await DATABASE.prepare(
        "SELECT count(*) AS n FROM media_usage_events",
      ).first(),
    ).toEqual({ n: 1 });
    expect(
      await DATABASE.prepare(
        "SELECT used_attempts FROM media_probe_run",
      ).first(),
    ).toEqual({ used_attempts: 1 });
  });
  it.each([{ offset: 1800000 }, { offset: -1800000 }, { offset: -1785001 }])(
    "rejects before start, expiry and last fifteen seconds atomically: %j",
    async (options) => {
      await register(options);
      const fake = installFake();
      await expect(submit()).rejects.toMatchObject({
        code: "media_ledger_unavailable",
      });
      expect(fake.submissions).toHaveLength(0);
      expect(
        await DATABASE.prepare("SELECT count(*) AS n FROM media_jobs").first(),
      ).toEqual({ n: 0 });
      expect(
        await DATABASE.prepare(
          "SELECT used_attempts FROM media_probe_run",
        ).first(),
      ).toEqual({ used_attempts: 0 });
    },
  );
  it("does not seed an unregistered run and rejects slot two/extra parameters without reservation", async () => {
    installFake();
    await expect(
      handleMediaProbe(request("/api/media-probe"), CONFIGURATION, IDENTITY),
    ).rejects.toMatchObject({ code: "media_probe_not_registered" });
    await register();
    for (const body of [
      { slot: 2, requestId: requestKey },
      { slot: 1, requestId: requestKey, prompt: "changed" },
      { slot: 1, requestId: requestKey, verified: true },
    ])
      await expect(
        handleMediaProbe(
          request("/api/media-probe/jobs", "POST", body),
          CONFIGURATION,
          IDENTITY,
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    expect(
      await DATABASE.prepare(
        "SELECT used_attempts FROM media_probe_run",
      ).first(),
    ).toEqual({ used_attempts: 0 });
    await expect(
      DATABASE.prepare("INSERT INTO media_probe_slots VALUES(1,2,?,?)")
        .bind(requestKey, "0".repeat(64))
        .run(),
    ).rejects.toThrow();
  });
  it("unknown submission retains spend, concurrency and maximum storage after a new driver/restart", async () => {
    await register();
    const fake = installFake({ hasUnknownSubmission: true });
    await expect(submit()).rejects.toMatchObject({
      code: "media_submission_unknown",
    });
    const job = await getMediaRequest(DATABASE, IDENTITY.id, requestKey);
    expect(job).toMatchObject({
      provider_state: "submission_unknown",
      attempt_count: 1,
      terminal_at: null,
    });
    expect(
      await DATABASE.prepare(
        "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
      )
        .bind(job?.id)
        .first(),
    ).toEqual({ held_bytes: 20971520 });
    expect(await readProbeRun({ ...CONFIGURATION }, IDENTITY.id)).toMatchObject(
      { used_attempts: 1, is_stopped: 1 },
    );
    await submit();
    expect(fake.submissions).toHaveLength(1);
    await expect(
      closeMediaProbe(CONFIGURATION, IDENTITY.id),
    ).rejects.toMatchObject({ code: "media_probe_unresolved" });
  });
  it("cannot refund counters, rewrite absolute dates, unstop or mutate slots", async () => {
    await register();
    installFake();
    await submit();
    for (const statement of [
      "UPDATE media_probe_run SET used_attempts=0",
      "UPDATE media_probe_run SET is_stopped=0",
      "UPDATE media_probe_run SET expires_at=expires_at+1800000,started_at=started_at+1800000",
      "UPDATE media_probe_slots SET input_hash='changed'",
    ])
      await expect(DATABASE.prepare(statement).run()).rejects.toThrow();
  });
  it("forged permit and another endpoint cannot enter the normal internal path", async () => {
    await register();
    const fake = installFake();
    const forged = {
      environment: CONFIGURATION,
      owner: IDENTITY.id,
      requestKey,
    };
    expect(() => assertProbePermit(forged, CONFIGURATION)).toThrow();
    const permit = await authorizeMediaProbe(
      CONFIGURATION,
      IDENTITY,
      requestKey,
    );
    await expect(
      submitMedia(
        {
          env: CONFIGURATION,
          identity: IDENTITY,
          probe: permit,
          driver: createImageDriver(CONFIGURATION, fake.transport, permit),
        },
        {
          ...probeInput(requestKey),
          model: "openai/gpt-image-2.5/flare/text-to-image",
        },
      ),
    ).rejects.toMatchObject({ code: "media_probe_not_authorized" });
    expect(fake.submissions).toHaveLength(0);
  });
  it("operator stop after reservation prevents atomic dispatch without refunding consumption", async () => {
    await register();
    installFake();
    const permit = await authorizeMediaProbe(
      CONFIGURATION,
      IDENTITY,
      requestKey,
    );
    const media = normalizeMedia(probeInput(requestKey));
    const reserved = await reserveMedia(
      DATABASE,
      IDENTITY.id,
      media,
      await inputHash(media),
      [],
      Date.now(),
      permit,
    );
    await stopMediaProbe(CONFIGURATION, IDENTITY.id);
    await expect(
      claimProbeDispatch(permit, reserved.job.id),
    ).rejects.toMatchObject({ code: "media_probe_ledger_unavailable" });
    expect(
      await DATABASE.prepare("SELECT attempt_count FROM media_jobs WHERE id=?")
        .bind(reserved.job.id)
        .first(),
    ).toEqual({ attempt_count: 0 });
    expect(await readProbeRun(CONFIGURATION, IDENTITY.id)).toMatchObject({
      used_attempts: 1,
    });
  });
  it("last transport guard rejects stop after dispatch claim", async () => {
    await register();
    const permit = await authorizeMediaProbe(
        CONFIGURATION,
        IDENTITY,
        requestKey,
      ),
      media = normalizeMedia(probeInput(requestKey));
    const reservation = await reserveMedia(
      DATABASE,
      IDENTITY.id,
      media,
      await inputHash(media),
      [],
      Date.now(),
      permit,
    );
    await claimProbeDispatch(permit, reservation.job.id);
    await stopMediaProbe(CONFIGURATION, IDENTITY.id);
    await expect(
      beforeProbeSubmit(permit, reservation.job.id),
    ).rejects.toMatchObject({ code: "media_probe_dispatch_not_claimed" });
  });
  it("counts bounded management calls persistently and keeps unknown on depletion", async () => {
    await register();
    installFake();
    const job = await submit(),
      permit = await permitFor(job.id);
    for (let index = 0; index < 4; index++)
      await reserveProbeCall(permit, "token");
    await expect(
      reserveProbeCall(await permitFor(job.id), "token"),
    ).rejects.toMatchObject({ code: "media_probe_call_limit" });
    await reserveProbeCall(permit, "status");
    await expect(reserveProbeCall(permit, "status")).rejects.toMatchObject({
      code: "media_probe_call_limit",
    });
  });
  it("closed runs deny stale authenticated job/asset access and appear in recovery witness", async () => {
    await register();
    installFake();
    const job = await complete();
    const asset = await DATABASE.prepare(
      "SELECT asset_id FROM media_job_assets WHERE job_id=? AND role='output'",
    )
      .bind(job.id)
      .first<{ asset_id: string }>();
    await expect(
      closeMediaProbe(CONFIGURATION, IDENTITY.id),
    ).rejects.toMatchObject({ code: "media_probe_unresolved" });
    await deleteAsset(CONFIGURATION, IDENTITY, asset?.asset_id ?? "");
    const witness = await readMediaRecoveryWitness(DATABASE);
    expect(witness.probe).toBeDefined();
    await closeMediaProbe(CONFIGURATION, IDENTITY.id);
    await expect(
      assetFile(
        request("/file"),
        CONFIGURATION,
        IDENTITY,
        asset?.asset_id ?? "",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await listMediaJobs(CONFIGURATION, IDENTITY)).jobs).toHaveLength(0);
    await expect(
      reconcileMediaRecovery(DATABASE, witness, async () => true),
    ).rejects.toMatchObject({
      code: "media_recovery_manual_reconciliation_required",
    });
    expect(
      await DATABASE.prepare(
        "SELECT is_recovery_blocked FROM media_runtime_state",
      ).first(),
    ).toEqual({ is_recovery_blocked: 1 });
  });
  it("early body erasure removes upstream URL while spend metadata survives", async () => {
    await register();
    installFake();
    const job = await complete();
    expect(
      await DATABASE.prepare(
        "SELECT count(*) AS n FROM media_probe_output",
      ).first(),
    ).toEqual({ n: 1 });
    await eraseMediaBody(CONFIGURATION, IDENTITY, job.id);
    expect(
      await DATABASE.prepare(
        "SELECT count(*) AS n FROM media_probe_output",
      ).first(),
    ).toEqual({ n: 0 });
    expect(
      await DATABASE.prepare(
        "SELECT used_attempts FROM media_probe_run",
      ).first(),
    ).toEqual({ used_attempts: 1 });
    await maintainMediaRetention(DATABASE, Date.now() + 91 * 86400000);
    expect(
      await DATABASE.prepare(
        "SELECT used_attempts FROM media_probe_run",
      ).first(),
    ).toEqual({ used_attempts: 1 });
  });
  it("unknown witness and closed recovery flag never reopen a probe", async () => {
    await register();
    installFake({ hasUnknownSubmission: true });
    await expect(submit()).rejects.toBeTruthy();
    const witness = await readMediaRecoveryWitness(DATABASE);
    await blockMediaRecovery(DATABASE);
    await expect(
      authorizeMediaProbe(CONFIGURATION, IDENTITY, requestKey),
    ).rejects.toMatchObject({ code: "media_probe_not_registered" });
    await expect(
      reconcileMediaRecovery(DATABASE, witness, async () => true),
    ).rejects.toMatchObject({ code: "media_recovery_unresolved_jobs" });
  });
  it.each([
    { APP_ENV: "local" },
    { APP_ENV: "production" },
    { STAGING_POLICY: "verification" },
    { AUTH_MODE: "better-auth" },
    { ENABLE_MEDIA: "true" },
    {
      MEDIA_VERIFIED_IMAGE_MODELS:
        '["openai/gpt-image-2.5/sunburst/text-to-image"]',
    },
    { MEDIA_PROBE_APPROVAL_VERSION: "changed" },
    { FAL_KEY: undefined },
    { MEDIA_BUCKET: undefined },
    { ENABLE_AGENT: "true" },
  ])("configuration denies unauthorized capability %j", async (override) => {
    await register();
    const fake = installFake();
    await expect(
      handleMediaProbe(
        request("/api/media-probe"),
        { ...CONFIGURATION, ...override } as MediaEnv,
        IDENTITY,
      ),
    ).rejects.toMatchObject({ code: "media_probe_configuration_invalid" });
    expect(fake.submissions).toHaveLength(0);
  });
  it("real signed Access claims enforce owner, usual OFF APIs, origin and missing/malformed identity", async () => {
    await register();
    const fake = createMediaIntegrationFake(() => CONFIGURATION);
    vi.stubGlobal(
      "fetch",
      async (resource: RequestInfo | URL, initialization?: RequestInit) =>
        String(resource) ===
        "https://example-probe.cloudflareaccess.com/cdn-cgi/access/certs"
          ? Response.json(keySet)
          : fake.transport(resource, { ...initialization, redirect: "error" }),
    );
    expect(
      (
        await api.fetch(
          request("/api/media-probe"),
          CONFIGURATION,
          createExecutionContext(),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await authenticatedCall(
          "/api/media-probe",
          "GET",
          undefined,
          "other-subject",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await authenticatedCall(
          "/api/media/jobs",
          "POST",
          probeInput(requestKey),
        )
      ).status,
    ).toBe(404);
    expect(
      (await authenticatedCall("/api/media/assets", "POST", {})).status,
    ).toBe(404);
    const wrong = request("/api/media-probe/jobs", "POST", {
      slot: 1,
      requestId: requestKey,
    });
    wrong.headers.set("Origin", "https://other.example.test");
    wrong.headers.set("cf-access-jwt-assertion", await assertion());
    expect(
      (await api.fetch(wrong, CONFIGURATION, createExecutionContext())).status,
    ).toBe(403);
    expect(
      (
        await authenticatedCall("/api/media-probe/jobs", "POST", {
          slot: 1,
          requestId: requestKey,
        })
      ).status,
    ).toBe(202);
    expect(fake.submissions).toHaveLength(1);
    expect(
      (
        await authenticatedCall(
          "/api/media-probe",
          "GET",
          undefined,
          "fixture-subject",
          { ...CONFIGURATION, ENABLE_MEDIA_PROBE: "false" },
        )
      ).status,
    ).toBe(404);
  });
  it("observes private ACL, authentic token expiry and natural expiry with bounded counters; never exposes credentials", async () => {
    await register();
    const base = installFake();
    const job = await complete(),
      permit = await permitFor(job.id);
    let time = Date.now(),
      index = 0;
    const lifetimes = new Map<string, number>();
    const transport: typeof fetch = async (resource, initialization) => {
      const url = String(resource),
        headers = new Headers(initialization?.headers);
      if (url.startsWith("https://rest.fal.ai/storage/files/acl?"))
        return Response.json({ default: "forbid", rules: [] });
      if (url.includes("/storage/auth/token?")) {
        const value = `TEST_ONLY_observation_${++index}`;
        lifetimes.set(value, time + 300000);
        return Response.json({
          token: value,
          expires_at: new Date(time + 300000).toISOString(),
        });
      }
      if (url.startsWith("https://v3b.fal.media/")) {
        const credential = headers.get("Authorization")?.slice(7);
        if (!credential || (lifetimes.get(credential) ?? 0) <= time)
          return new Response(null, { status: 403 });
        const output = await DATABASE.prepare(
          "SELECT observed_at FROM media_probe_output",
        ).first<{ observed_at: number }>();
        if (time >= (output?.observed_at ?? 0) + 3600000)
          return new Response(null, { status: 410 });
        return new Response(null, { status: 200 });
      }
      return base.transport(resource, initialization);
    };
    expect(await diagnoseProbeAcl(permit, transport)).toEqual({
      acl: "pass",
      anonymous: "pass",
    });
    const clock = {
      now: () => time,
      sleep: async (milliseconds: number) => {
        time += milliseconds;
      },
    };
    expect(
      await observeProbeToken(
        permit,
        new AbortController().signal,
        transport,
        clock,
      ),
    ).toEqual({ token: "pass" });
    expect(await observeProbeExpiry(permit, transport, clock)).toEqual({
      expiry: "not_due",
    });
    time += 3600000;
    expect(await observeProbeExpiry(permit, transport, clock)).toEqual({
      expiry: "pass",
    });
    expect(
      await DATABASE.prepare(
        "SELECT count FROM media_probe_calls WHERE operation='token'",
      ).first(),
    ).toEqual({ count: 4 });
    expect(
      await DATABASE.prepare(
        "SELECT count FROM media_probe_calls WHERE operation='diagnostic'",
      ).first(),
    ).toEqual({ count: 4 });
    const publicState = await (
      await handleMediaProbe(
        request("/api/media-probe"),
        CONFIGURATION,
        IDENTITY,
      )
    ).text();
    expect(publicState).not.toContain("TEST_ONLY_observation_");
    expect(publicState).not.toContain("v3b.fal.media");
    expect(base.submissions).toHaveLength(1);
  });
  it("anonymous readable output is failure, not made private afterward", async () => {
    await register();
    installFake();
    const job = await complete(),
      permit = await permitFor(job.id);
    const transport: typeof fetch = async (resource) =>
      String(resource).startsWith("https://rest.fal.ai/")
        ? Response.json({ default: "allow", rules: [] })
        : new Response(null, { status: 200 });
    expect(await diagnoseProbeAcl(permit, transport)).toEqual({
      acl: "fail",
      anonymous: "fail",
    });
    expect(await readProbeRun(CONFIGURATION, IDENTITY.id)).toMatchObject({
      used_attempts: 1,
      is_stopped: 1,
    });
    expect(
      await DATABASE.prepare(
        "SELECT verdict FROM media_probe_evidence WHERE item='acl'",
      ).first(),
    ).toEqual({ verdict: "fail" });
  });
  it("interrupted token diagnostic leaves unknown without storing the token", async () => {
    await register();
    const base = installFake();
    const job = await complete(),
      permit = await permitFor(job.id);
    const controller = new AbortController();
    controller.abort();
    await expect(
      observeProbeToken(permit, controller.signal, base.transport),
    ).rejects.toMatchObject({ code: "media_probe_observation_unknown" });
    expect(
      await DATABASE.prepare(
        "SELECT verdict FROM media_probe_evidence WHERE item='token'",
      ).first(),
    ).toEqual({ verdict: "unknown" });
  });
  it.each(["published-example", "null", "missing"])(
    "accepts %s optional upstream metadata only after private byte validation",
    async (metadata) => {
      await register();
      const base = createMediaIntegrationFake(() => CONFIGURATION);
      let tokenRequests = 0;
      vi.stubGlobal(
        "fetch",
        async (resource: RequestInfo | URL, initialization?: RequestInit) => {
          if (
            String(resource).startsWith(
              "https://rest.fal.ai/storage/auth/token?",
            )
          )
            tokenRequests += 1;
          const result = await base.transport(resource, {
            ...initialization,
            redirect: "error",
          });
          if (/\/requests\/[^/]+$/.test(String(resource))) {
            const body = (await result.json()) as {
              images: Record<string, unknown>[];
            };
            for (const field of ["width", "height", "file_size"])
              if (metadata === "missing") delete body.images[0][field];
              else body.images[0][field] = null;
            if (metadata === "null") body.images[0].content_type = null;
            if (metadata === "missing") delete body.images[0].content_type;
            return Response.json(body);
          }
          return result;
        },
      );
      const job = await submit();
      await allowNextMediaPoll(job.id);
      const refreshed = await handleMediaProbe(
        request(`/api/media-probe/jobs/${job.id}/refresh`, "POST", {}),
        CONFIGURATION,
        IDENTITY,
      );
      expect(refreshed.status).toBe(200);
      expect(await refreshed.json()).toMatchObject({
        terminalOutcome: "stored",
      });
      expect(tokenRequests).toBe(1);
      expect(base.downloadCount()).toBe(1);
      await submit();
      expect(base.submissions).toHaveLength(1);
      expect(
        await DATABASE.prepare(
          "SELECT count(*) AS n FROM media_assets",
        ).first(),
      ).toEqual({ n: 1 });
    },
  );
  it.each(["result_shape", "result_count", "url_policy"])(
    "returns only the fixed %s rejection category without downloading output",
    async (invalidReason) => {
      await register();
      const base = createMediaIntegrationFake(() => CONFIGURATION);
      let tokenRequests = 0;
      vi.stubGlobal(
        "fetch",
        async (resource: RequestInfo | URL, initialization?: RequestInit) => {
          if (
            String(resource).startsWith(
              "https://rest.fal.ai/storage/auth/token?",
            )
          )
            tokenRequests += 1;
          const result = await base.transport(resource, {
            ...initialization,
            redirect: "error",
          });
          if (!/\/requests\/[^/]+$/.test(String(resource))) return result;
          const body = (await result.json()) as {
            images: Record<string, unknown>[] | null;
          };
          if (invalidReason === "result_shape") body.images = null;
          else if (invalidReason === "result_count")
            body.images?.push({
              ...body.images[0],
              url: "https://v3b.fal.media/files/b/TEST_ONLY_store/other.png",
            });
          else if (body.images)
            body.images[0].url = "https://example.invalid/image.png";
          return Response.json(body);
        },
      );
      const job = await submit();
      await allowNextMediaPoll(job.id);
      const refreshed = await handleMediaProbe(
        request(`/api/media-probe/jobs/${job.id}/refresh`, "POST", {}),
        CONFIGURATION,
        IDENTITY,
      );
      expect(refreshed.status).toBe(200);
      expect(await refreshed.json()).toMatchObject({
        terminalOutcome: "invalid",
        invalidReason,
      });
      const state = await handleMediaProbe(
        request("/api/media-probe"),
        CONFIGURATION,
        IDENTITY,
      );
      expect(await state.json()).toMatchObject({
        job: { invalidReason },
      });
      await expect(
        DATABASE.prepare(
          "UPDATE media_probe_attempts SET invalid_reason='image_bytes' WHERE job_id=?",
        )
          .bind(job.id)
          .run(),
      ).rejects.toThrow("MEDIA_PROBE_DENIED");
      expect(tokenRequests).toBe(0);
      expect(base.downloadCount()).toBe(0);
      expect(base.submissions).toHaveLength(1);
      expect(
        await DATABASE.prepare(
          "SELECT count(*) AS n FROM media_assets",
        ).first(),
      ).toEqual({ n: 0 });
    },
  );
  it("ordinary verified media cannot refresh or retry a probe job", async () => {
    await register();
    installFake();
    const job = await complete();
    const ordinary = {
      ...CONFIGURATION,
      ENABLE_MEDIA_PROBE: "false",
      ENABLE_MEDIA: "true",
      MEDIA_ALLOWED_MODELS: '["openai/gpt-image-2.5/sunburst/text-to-image"]',
      MEDIA_VERIFIED_IMAGE_MODELS:
        '["openai/gpt-image-2.5/sunburst/text-to-image"]',
    };
    const context = {
      env: ordinary,
      identity: IDENTITY,
      driver: createImageDriver(ordinary),
    };
    await expect(advanceMediaJob(context, job.id)).rejects.toMatchObject({
      code: "media_probe_not_authorized",
    });
    await expect(resumeMediaCollection(context, job.id)).rejects.toMatchObject({
      code: "media_probe_not_authorized",
    });
    await expect(
      submitMedia(context, probeInput(requestKey)),
    ).rejects.toMatchObject({ code: "media_probe_not_authorized" });
  });
  it("redirect replies never forward credentials and still consume the first attempt", async () => {
    await register();
    const destinations: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (resource: RequestInfo | URL, initialization?: RequestInit) => {
        destinations.push(String(resource));
        expect(initialization?.redirect).toBe("manual");
        return new Response(null, {
          status: 307,
          headers: { Location: "https://forged.example.invalid/collect" },
        });
      },
    );
    await expect(submit()).rejects.toMatchObject({
      code: "media_provider_unavailable",
    });
    expect(destinations).toEqual([
      "https://queue.fal.run/openai/gpt-image-2.5/sunburst/text-to-image",
    ]);
    expect(
      await getMediaRequest(DATABASE, IDENTITY.id, requestKey),
    ).toMatchObject({ provider_state: "submission_unknown" });
    expect(await readProbeRun(CONFIGURATION, IDENTITY.id)).toMatchObject({
      used_attempts: 1,
      is_stopped: 1,
    });
  });
  it.each([
    [3600, 200],
    [21600, 200],
    [21605, 200],
    [21606, 401],
    [86400, 401],
  ])(
    "probe Access lifetime %i seconds returns %i",
    async (lifetimeSeconds, expectedStatus) => {
      await register();
      vi.stubGlobal("fetch", async () => Response.json(keySet));
      const incoming = request("/api/media-probe");
      const issuedAt = Math.floor(Date.now() / 1000);
      incoming.headers.set(
        "cf-access-jwt-assertion",
        await new SignJWT({
          sub: "fixture-subject",
          email: "probe@example.test",
          type: "app",
        })
          .setProtectedHeader({ alg: "RS256", kid: "TEST_ONLY_probe" })
          .setIssuer("https://example-probe.cloudflareaccess.com")
          .setAudience(CONFIGURATION.ACCESS_AUD ?? "")
          .setIssuedAt(issuedAt)
          .setExpirationTime(issuedAt + lifetimeSeconds)
          .sign(keys.privateKey),
      );
      expect(
        (await api.fetch(incoming, CONFIGURATION, createExecutionContext()))
          .status,
      ).toBe(expectedStatus);
    },
  );
  it("probe OFF preserves normal Access sessions beyond the probe lifetime limit", async () => {
    vi.stubGlobal("fetch", async () => Response.json(keySet));
    const incoming = request("/api/session");
    incoming.headers.set(
      "cf-access-jwt-assertion",
      await new SignJWT({
        sub: "fixture-subject",
        email: "probe@example.test",
        type: "app",
      })
        .setProtectedHeader({ alg: "RS256", kid: "TEST_ONLY_probe" })
        .setIssuer("https://example-probe.cloudflareaccess.com")
        .setAudience(CONFIGURATION.ACCESS_AUD ?? "")
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(keys.privateKey),
    );
    const normalConfiguration: MediaEnv = {
      ...CONFIGURATION,
      ENABLE_MEDIA_PROBE: "false",
    };
    const response = await api.fetch(
      incoming,
      normalConfiguration,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      identity: { id: IDENTITY.id },
    });
  });
  it("closed spent state is retained for ninety terminal days and never recreated by expiry", async () => {
    await register();
    installFake();
    const job = await complete();
    const asset = await DATABASE.prepare(
      "SELECT asset_id FROM media_job_assets WHERE job_id=?",
    )
      .bind(job.id)
      .first<{ asset_id: string }>();
    await deleteAsset(CONFIGURATION, IDENTITY, asset?.asset_id ?? "");
    await closeMediaProbe(CONFIGURATION, IDENTITY.id);
    await maintainMediaRetention(DATABASE, Date.now() + 89 * 86400000);
    expect(
      await DATABASE.prepare(
        "SELECT used_attempts FROM media_probe_run",
      ).first(),
    ).toEqual({ used_attempts: 1 });
    await maintainMediaRetention(DATABASE, Date.now() + 91 * 86400000);
    expect(
      await DATABASE.prepare(
        "SELECT count(*) AS n FROM media_probe_run",
      ).first(),
    ).toEqual({ n: 0 });
    await expect(
      readProbeRun(CONFIGURATION, IDENTITY.id),
    ).rejects.toMatchObject({ code: "media_probe_not_registered" });
  });
});
