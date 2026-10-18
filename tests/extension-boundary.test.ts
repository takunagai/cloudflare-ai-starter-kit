import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { Webhook } from "standardwebhooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideNote, noteTools } from "../src/server/agent-tools";
import {
  chatModelCatalog,
  selectableChatModelIds,
  verificationModelId,
} from "../src/server/ai/catalog";
import { getModel, listModels } from "../src/server/ai/providers";
import api from "../src/server/api";
import {
  type BillingProvider,
  createBillingHandler,
  createPolarProvider,
} from "../src/server/billing";
import type { Identity } from "../src/server/env";
import {
  cancelImage,
  getImage,
  listImages,
  submitImage,
} from "../src/server/extensions/images";
import {
  deleteDocument,
  getDocument,
  listDocuments,
  retrieveRag,
  uploadDocument,
} from "../src/server/extensions/rag";
import {
  decideSummary,
  getSummary,
  listSummaries,
  runSummaryJob,
  type SummaryParams,
  startSummary,
} from "../src/server/extensions/workflows";
import type { RuntimeEnv } from "../src/server/runtime-guards";
import * as runtime from "../src/server/runtime-guards";

const database = env.DB;
if (!database) throw new Error("TEST_ONLY_missing_database");
const db: D1Database = database;
const ledgerSQL = "SELECT 1 AS present FROM ai_verification LIMIT 1";
const alice: Identity = {
  id: "TEST_ONLY_alice",
  email: "alice@example.test",
  name: "Alice",
};
const bob: Identity = {
  id: "TEST_ONLY_bob",
  email: "bob@example.test",
  name: "Bob",
};
const imageId = "00000000-0000-4000-8000-000000000003";
const documentId = "00000000-0000-4000-8000-000000000004";
const summaryId = "d".repeat(64);
const secret = `whsec_${Buffer.from("TEST_ONLY_B3_webhook_signing_fixture").toString("base64")}`;
const toolOptions = { toolCallId: "TEST_ONLY_tool", messages: [], context: {} };
let config: RuntimeEnv;
let search: ReturnType<
  typeof vi.fn<
    (input: AiSearchSearchRequest) => Promise<AiSearchSearchResponse>
  >
>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let create: ReturnType<typeof vi.fn>;
let sendEvent: ReturnType<typeof vi.fn>;
let checkout: ReturnType<typeof vi.fn<BillingProvider["checkout"]>>;
let portal: ReturnType<typeof vi.fn<BillingProvider["portal"]>>;
let handleBilling: ReturnType<typeof createBillingHandler>;

beforeEach(async () => {
  search = vi.fn(async () => ({ search_query: "test", chunks: [] }));
  fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      request_id: "TEST_ONLY_request",
      status_url:
        "https://queue.fal.run/fal-ai/flux/requests/TEST_ONLY_request/status",
      response_url:
        "https://queue.fal.run/fal-ai/flux/requests/TEST_ONLY_request",
      cancel_url:
        "https://queue.fal.run/fal-ai/flux/requests/TEST_ONLY_request/cancel",
    }),
  );
  create = vi.fn(async () => ({}));
  sendEvent = vi.fn(async () => undefined);
  checkout = vi.fn(async () => ({
    id: "TEST_ONLY_checkout",
    url: "https://sandbox.polar.sh/checkout/test",
    expiresAt: new Date(Date.now() + 600000),
  }));
  portal = vi.fn(async () => ({ url: "https://sandbox.polar.sh/portal/test" }));
  handleBilling = createBillingHandler(() => ({ checkout, portal }));
  config = {
    ...env,
    DB: db,
    APP_ENV: "staging",
    APP_ORIGIN: "https://standard.example.invalid",
    STAGING_POLICY: "standard",
    LOCAL_DEMO: "false",
    AI_MODE: "selected",
    AI_ALLOWED_MODELS: JSON.stringify([verificationModelId]),
    AI_VERIFICATION_ENABLED: "false",
    AI_VERIFICATION_START: "",
    ENABLE_RAG: "true",
    ENABLE_IMAGES: "true",
    ENABLE_WORKFLOWS: "true",
    ENABLE_AGENT: "true",
    ENABLE_BILLING: "true",
    AI: { run: vi.fn() } as unknown as Ai,
    AI_SEARCH: { search },
    FAL_KEY: "TEST_ONLY_dummy_key",
    POLAR_PRODUCT_ID: "TEST_ONLY_product",
    POLAR_WEBHOOK_SECRET: secret,
    SUMMARY_WORKFLOW: {
      create,
      get: async () => ({
        sendEvent,
        status: async () => ({ status: "running" }),
      }),
    } as unknown as Workflow,
  };
  await db.batch(
    [
      "saved_summaries",
      "summary_jobs",
      "rag_documents",
      "image_jobs",
      "tool_approvals",
      "notes",
      "billing_events",
      "billing_subscriptions",
      "billing_checkouts",
      "billing_customers",
      "app_rate_limits",
      "ai_verification",
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  );
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("TEST_ONLY_unexpected_network"),
  );
});
afterEach(() => vi.restoreAllMocks());

async function seedLedger() {
  await db
    .prepare("INSERT INTO ai_verification VALUES (1,?,?,?,2)")
    .bind("TEST_ONLY_legacy", 1, 1800001)
    .run();
}
const imageInput = () => ({
  requestId: crypto.randomUUID(),
  model: "fal-ai/flux/schnell" as const,
  prompt: "test",
  size: "square" as const,
});
const summaryInput = () => ({
  requestId: crypto.randomUUID(),
  model: verificationModelId,
  input: "test",
});
function bill(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  return new Request(`${config.APP_ORIGIN}/api/billing/${path}`, {
    method,
    headers: { Origin: config.APP_ORIGIN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function signed(
  eventId = crypto.randomUUID(),
  event: unknown = { type: "TEST_ONLY_unused_event" },
) {
  const body = JSON.stringify(event);
  const timestamp = new Date();
  return new Request(`${config.APP_ORIGIN}/api/billing/webhook`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "webhook-id": eventId,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": new Webhook(secret).sign(eventId, timestamp, body),
    },
  });
}
async function summary(state = "starting", owner = alice.id) {
  await db
    .prepare(
      "INSERT INTO summary_jobs(id,owner_id,request_key,input_hash,model,input,state,summary,decision,approval_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      summaryId,
      owner,
      crypto.randomUUID(),
      "TEST_ONLY_hash",
      verificationModelId,
      "text",
      state,
      state === "awaiting_approval" ? "summary" : null,
      null,
      Date.now() + 60000,
      Date.now(),
      Date.now(),
    )
    .run();
}
function event(
  ownerId: string | undefined = alice.id,
): WorkflowEvent<SummaryParams> {
  return {
    payload: { jobId: summaryId, ownerId },
    instanceId: summaryId,
    timestamp: new Date(),
    workflowName: "TEST_ONLY_workflow",
  };
}
function steps(wait: () => Promise<void> = async () => {}) {
  return {
    do: async (
      _name: string,
      _options: unknown,
      action: () => Promise<unknown>,
    ) => action(),
    waitForEvent: async () => {
      await wait();
      return { payload: {} };
    },
  } as unknown as WorkflowStep;
}
function expectNoExternal() {
  for (const fn of [
    search,
    fetcher,
    create,
    sendEvent,
    checkout,
    portal,
    fetch,
  ])
    expect(fn).not.toHaveBeenCalled();
}

function blockOnCheck(at: number) {
  const check = runtime.checkExtensionRuntimePolicy;
  let n = 0;
  vi.spyOn(runtime, "checkExtensionRuntimePolicy").mockImplementation(
    async (target) => {
      if (++n === at) await seedLedger();
      await check(target);
    },
  );
}

async function webhookCall(request: Request) {
  const ctx = createExecutionContext();
  const response = await api.fetch(request, config, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("B-3 synchronous catalog and direct model selection", () => {
  it.each(selectableChatModelIds)(
    "shares catalog and refuses a credential-only request for %s",
    (id) => {
      const target: RuntimeEnv = {
        ...config,
        APP_ENV: "local",
        APP_ORIGIN: "http://127.0.0.1:3000",
        STAGING_POLICY: undefined,
        AI_ALLOWED_MODELS: JSON.stringify([id]),
        OPENAI_API_KEY: "TEST_ONLY_dummy",
        ANTHROPIC_API_KEY: "TEST_ONLY_dummy",
        GOOGLE_GENERATIVE_AI_API_KEY: "TEST_ONLY_dummy",
        OPENROUTER_API_KEY: "TEST_ONLY_dummy",
        LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
        LM_STUDIO_MODEL: "TEST_ONLY_model",
      };
      const prepare = vi.spyOn(db, "prepare");
      expect(listModels(target).map(({ id }) => id)).toEqual(
        chatModelCatalog.map(({ id }) => id),
      );
      expect(
        listModels(target)
          .filter(({ available }) => available)
          .map(({ id }) => id),
      ).toEqual([id]);
      expect(() => getModel(id, target)).not.toThrow();
      for (const overrides of [
        { AI_MODE: "off", AI_ALLOWED_MODELS: "[]" },
        { AI_MODE: undefined, AI_ALLOWED_MODELS: undefined },
        { AI_MODE: "invalid" },
      ]) {
        const denied = { ...target, ...overrides };
        expect(listModels(denied).every(({ available }) => !available)).toBe(
          true,
        );
        expect(() => getModel(id, denied)).toThrow("model_unavailable");
      }
      expect(prepare).not.toHaveBeenCalled();
      expectNoExternal();
    },
  );
});

describe("B-3 independent extension guards and priority on D1", () => {
  it.each(["rag", "images", "workflows", "billing"])(
    "rechecks %s after reservation without refund or dispatch",
    async (feature) => {
      blockOnCheck(feature === "billing" ? 3 : 2);
      if (feature === "rag") {
        await expect(retrieveRag(config, alice, "test")).rejects.toMatchObject({
          status: 503,
        });
        expect(
          await db
            .prepare(
              "SELECT count FROM app_rate_limits WHERE key LIKE 'rag-search:%'",
            )
            .first("count"),
        ).toBe(1);
      } else if (feature === "images") {
        await expect(
          submitImage(config, alice, imageInput(), fetcher),
        ).rejects.toMatchObject({ status: 503 });
        expect(
          await db.prepare("SELECT state FROM image_jobs").first("state"),
        ).toBe("failed");
      } else if (feature === "workflows") {
        await expect(
          startSummary(config, alice, summaryInput()),
        ).rejects.toMatchObject({ status: 503 });
        expect(
          await db.prepare("SELECT state FROM summary_jobs").first("state"),
        ).toBe("failed");
      } else {
        expect(
          (await handleBilling(bill("checkout", {}), config, alice))?.status,
        ).toBe(503);
        expect(
          await db
            .prepare("SELECT state FROM billing_checkouts")
            .first("state"),
        ).toBe("expired");
      }
      expectNoExternal();
    },
  );

  it("rechecks signed HTTP webhook immediately before persistence", async () => {
    blockOnCheck(2);
    expect((await webhookCall(signed())).status).toBe(503);
    expect(
      await db.prepare("SELECT count(*) AS n FROM billing_events").first("n"),
    ).toBe(0);
    expectNoExternal();
  });
  it("guards direct Polar transport methods before network", async () => {
    await seedLedger();
    const direct = createPolarProvider({
      ...config,
      POLAR_ACCESS_TOKEN: "TEST_ONLY_dummy_token",
    });
    await expect(
      direct.checkout({
        ownerId: alice.id,
        productId: "TEST_ONLY_product",
        operationId: "TEST_ONLY_operation",
        returnUrl: "https://standard.example.invalid/app",
      }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      direct.portal({
        ownerId: alice.id,
        returnUrl: "https://standard.example.invalid/app",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expectNoExternal();
  });
  it.each(["off", "invalid"])(
    "AI_MODE=%s and invalid Jev do not stop independent extensions",
    async (mode) => {
      config = {
        ...config,
        AI_MODE: mode,
        AI_ALLOWED_MODELS: "[]",
        JEV_MODE: "invalid",
      };
      expect(await retrieveRag(config, alice, "test")).toMatchObject({
        sources: [],
      });
      expect(
        await submitImage(config, alice, imageInput(), fetcher),
      ).toMatchObject({ state: "queued" });
      expect(
        (await handleBilling(bill("checkout", {}), config, alice))?.status,
      ).toBe(200);
      expect(search).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(checkout).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["row", "missing", "error"] as const)(
    "%s ledger stops admission and related updates",
    async (kind) => {
      if (kind === "row") await seedLedger();
      if (kind === "missing")
        await db
          .prepare("ALTER TABLE ai_verification RENAME TO b3_missing_table")
          .run();
      if (kind === "error") {
        const prepare = db.prepare.bind(db);
        vi.spyOn(db, "prepare").mockImplementation((sql) => {
          if (sql === ledgerSQL) throw new Error("TEST_ONLY_private_detail");
          return prepare(sql);
        });
      }
      try {
        const code =
          kind === "row"
            ? "legacy_verification_ledger"
            : "verification_ledger_unavailable";
        for (const action of [
          () => uploadDocument(config, alice, { title: "test", text: "test" }),
          () => retrieveRag(config, alice, "test"),
          () => submitImage(config, alice, imageInput(), fetcher),
          () => startSummary(config, alice, summaryInput()),
          () => listImages(config, alice),
          () => listDocuments(config, alice),
          () => listSummaries(config, alice),
          () =>
            noteTools(config, alice, () => {}).draftNote.execute?.(
              { title: "test", content: "test" },
              toolOptions,
            ),
        ])
          await expect(action()).rejects.toMatchObject({ status: 503, code });
        for (const path of ["checkout", "status"])
          expect(
            (
              await handleBilling(
                bill(path, path === "checkout" ? {} : undefined),
                config,
                alice,
              )
            )?.status,
          ).toBe(503);
        expect((await handleBilling(signed(), config, null))?.status).toBe(503);
        for (const table of [
          "rag_documents",
          "image_jobs",
          "summary_jobs",
          "tool_approvals",
          "billing_events",
          "billing_checkouts",
        ])
          expect(
            await db.prepare(`SELECT count(*) AS n FROM ${table}`).first("n"),
          ).toBe(0);
        expectNoExternal();
      } finally {
        if (kind === "missing")
          await db
            .prepare("ALTER TABLE b3_missing_table RENAME TO ai_verification")
            .run();
      }
    },
  );

  it("keeps OFF, input, owner and state errors ahead of ledger/configuration errors", async () => {
    await seedLedger();
    config = {
      ...config,
      FAL_KEY: undefined,
      SUMMARY_WORKFLOW: undefined,
      RAG_BUCKET: undefined,
      POLAR_PRODUCT_ID: undefined,
    };
    const prepare = vi.spyOn(db, "prepare");
    await expect(
      submitImage(config, alice, { ...imageInput(), prompt: "" }, fetcher),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      uploadDocument(config, alice, { title: "", text: "test" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      startSummary(config, alice, { ...summaryInput(), input: "" }),
    ).rejects.toMatchObject({ status: 400 });
    for (const action of [
      () => getImage(config, bob, imageId, fetcher),
      () => cancelImage(config, bob, imageId, fetcher),
      () => getDocument(config, bob, documentId),
      () => deleteDocument(config, bob, documentId),
      () => getSummary(config, bob, summaryId),
      () => decideSummary(config, bob, summaryId, "approve"),
      () => decideNote(config, bob, imageId, "approve"),
    ])
      await expect(action()).rejects.toMatchObject({ status: 404 });
    expect(
      (await handleBilling(bill("checkout", {}), config, null))?.status,
    ).toBe(401);
    expect((await handleBilling(bill("checkout"), config, alice))?.status).toBe(
      405,
    );
    expect(
      (await handleBilling(bill("checkout", { bad: true }), config, alice))
        ?.status,
    ).toBe(400);
    expect((await handleBilling(bill("portal", {}), config, bob))?.status).toBe(
      409,
    );
    const off = {
      ...config,
      ENABLE_RAG: "false",
      ENABLE_IMAGES: "false",
      ENABLE_WORKFLOWS: "false",
      ENABLE_AGENT: "false",
      ENABLE_BILLING: "false",
    };
    for (const action of [
      () => retrieveRag(off, alice, "test"),
      () => submitImage(off, alice, imageInput(), fetcher),
      () => startSummary(off, alice, summaryInput()),
      () => decideNote(off, alice, imageId, "approve"),
    ])
      await expect(action()).rejects.toMatchObject({ status: 404 });
    expect((await handleBilling(signed(), off, null))?.status).toBe(404);
    expect(prepare.mock.calls.some(([sql]) => sql === ledgerSQL)).toBe(false);
    expectNoExternal();
  });

  it.each([undefined, "verification"])(
    "keeps staging extensions closed without STAGING_POLICY=standard (policy %s)",
    async (policy) => {
      config = {
        ...config,
        STAGING_POLICY: policy,
        AI_MODE: undefined,
        AI_ALLOWED_MODELS: undefined,
      };
      const prepare = vi.spyOn(db, "prepare");
      for (const action of [
        () => retrieveRag(config, alice, "test"),
        () => submitImage(config, alice, imageInput(), fetcher),
        () => startSummary(config, alice, summaryInput()),
        () => decideNote(config, alice, imageId, "approve"),
      ])
        await expect(action()).rejects.toMatchObject({ status: 404 });
      expect((await handleBilling(signed(), config, null))?.status).toBe(404);
      expect(prepare).not.toHaveBeenCalled();
      expectNoExternal();
    },
  );

  it.each(["customer.state_changed", "checkout.updated"])(
    "rejects malformed signed %s before inspecting the ledger",
    async (type) => {
      await seedLedger();
      const prepare = vi.spyOn(db, "prepare");
      const response = await webhookCall(signed(crypto.randomUUID(), { type }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_webhook" });
      expect(prepare.mock.calls.some(([sql]) => sql === ledgerSQL)).toBe(false);
      expect(
        await db.prepare("SELECT count(*) AS n FROM billing_events").first("n"),
      ).toBe(0);
      expectNoExternal();
    },
  );

  it("checks signed webhooks before ledger and never acknowledges a blocked duplicate", async () => {
    const eventId = crypto.randomUUID();
    await seedLedger();
    const prepare = vi.spyOn(db, "prepare");
    const bad = signed(eventId);
    bad.headers.set("webhook-signature", "v1,TEST_ONLY_invalid");
    expect((await webhookCall(bad)).status).toBe(403);
    expect(prepare.mock.calls.some(([sql]) => sql === ledgerSQL)).toBe(false);
    const before = (await db.prepare("SELECT * FROM ai_verification").all())
      .results;
    expect((await webhookCall(signed(eventId))).status).toBe(503);
    expect(
      await db.prepare("SELECT count(*) AS n FROM billing_events").first("n"),
    ).toBe(0);
    expect(
      (await db.prepare("SELECT * FROM ai_verification").all()).results,
    ).toEqual(before);
    // 合成一時DBだけを戻して同じイベントの再送/重複を検証。
    await db.prepare("DELETE FROM ai_verification").run();
    expect((await webhookCall(signed(eventId))).status).toBe(200);
    await seedLedger();
    expect((await webhookCall(signed(eventId))).status).toBe(503);
    await db.prepare("DELETE FROM ai_verification").run();
    expect(
      await (await handleBilling(signed(eventId), config, null))?.json(),
    ).toEqual({ received: true, duplicate: true });
    expect(
      await db.prepare("SELECT count(*) AS n FROM billing_events").first("n"),
    ).toBe(1);
    expectNoExternal();
  });
});

describe("B-3 Workflow durable owner, state and resume checks", () => {
  it.each(["ledger", "off", "unselected", "invalid", "legacy"])(
    "%s refuses inference on resume",
    async (kind) => {
      await summary();
      if (kind === "ledger") await seedLedger();
      if (kind === "off")
        config = { ...config, AI_MODE: "off", AI_ALLOWED_MODELS: "[]" };
      if (kind === "unselected")
        config = { ...config, AI_ALLOWED_MODELS: '["openai/gpt-4.1-mini"]' };
      if (kind === "invalid") config = { ...config, STAGING_POLICY: "unknown" };
      if (kind === "legacy")
        config = {
          ...config,
          STAGING_POLICY: undefined,
          AI_MODE: undefined,
          AI_ALLOWED_MODELS: undefined,
        };
      const summarize = vi.fn(async () => "test");
      await expect(
        runSummaryJob(config, event(), steps(), summarize),
      ).rejects.toThrow("SUMMARY_WORKFLOW_FAILED");
      expect(summarize).not.toHaveBeenCalled();
      expect(
        await db
          .prepare("SELECT count(*) AS n FROM saved_summaries")
          .first("n"),
      ).toBe(0);
      expect(
        await db
          .prepare("SELECT state FROM summary_jobs WHERE id=?")
          .bind(summaryId)
          .first("state"),
      ).toBe("failed");
      expectNoExternal();
    },
  );

  it.each(["owner", "state"])(
    "checks %s before policy or inference",
    async (kind) => {
      await summary(kind === "state" ? "failed" : "starting");
      await seedLedger();
      const prepare = vi.spyOn(db, "prepare");
      const summarize = vi.fn(async () => "test");
      await expect(
        runSummaryJob(
          config,
          event(kind === "owner" ? bob.id : alice.id),
          steps(),
          summarize,
        ),
      ).rejects.toThrow("SUMMARY_WORKFLOW_FAILED");
      expect(prepare.mock.calls.some(([sql]) => sql === ledgerSQL)).toBe(false);
      expect(summarize).not.toHaveBeenCalled();
      if (kind === "owner")
        expect(
          await db
            .prepare("SELECT state FROM summary_jobs WHERE id=?")
            .bind(summaryId)
            .first("state"),
        ).toBe("starting");
    },
  );

  it("rechecks after the durable wait and preserves consumption without saving", async () => {
    await summary();
    const summarize = vi.fn(async () => "TEST_ONLY_summary");
    await expect(
      runSummaryJob(
        config,
        event(),
        steps(async () => {
          await db
            .prepare("UPDATE summary_jobs SET decision='approve' WHERE id=?")
            .bind(summaryId)
            .run();
          await seedLedger();
        }),
        summarize,
      ),
    ).rejects.toThrow("SUMMARY_WORKFLOW_FAILED");
    expect(summarize).toHaveBeenCalledOnce();
    expect(
      await db
        .prepare("SELECT state,summary,decision FROM summary_jobs WHERE id=?")
        .bind(summaryId)
        .first(),
    ).toEqual({
      state: "failed",
      summary: "TEST_ONLY_summary",
      decision: "approve",
    });
    expect(
      await db.prepare("SELECT count(*) AS n FROM saved_summaries").first("n"),
    ).toBe(0);
  });

  it("does not trust event payload approval or recreate a cached inference on resume", async () => {
    await summary("awaiting_approval");
    const summarize = vi.fn(async () => "should_not_run");
    await seedLedger();
    const cached = steps();
    cached.do = vi.fn(
      async (
        name: string,
        _options: unknown,
        action: () => Promise<unknown>,
      ) => (name === "summarize" ? { summarized: true } : action()),
    ) as unknown as WorkflowStep["do"];
    const legacyEvent = { ...event(), payload: { jobId: summaryId } };
    await expect(
      runSummaryJob(config, legacyEvent, cached, summarize),
    ).rejects.toThrow("SUMMARY_WORKFLOW_FAILED");
    expect(summarize).not.toHaveBeenCalled();
    expect(
      await db.prepare("SELECT count(*) AS n FROM saved_summaries").first("n"),
    ).toBe(0);
  });
});
