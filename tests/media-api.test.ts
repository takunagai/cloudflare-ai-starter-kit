import { createExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../src/server/api";
import { MEDIA_MODEL_IDS } from "../src/server/media/catalog";
import type { MediaEnv } from "../src/server/media/policy";
import { eraseMediaBody } from "../src/server/media/retention";
import { submitMedia } from "../src/server/media/service";
import {
  MEDIA_DATABASE as database,
  MEDIA_ENV,
  mediaDriver,
  mediaInput,
  resetMediaDatabase,
} from "./media-fixtures";
import { savedMediaImage, syntheticPng } from "./media-image-fixtures";

const ORIGIN = "http://127.0.0.1:3000";
function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
  headers?: HeadersInit,
) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const call = (input: Request, config = MEDIA_ENV) =>
  api.fetch(input, config, createExecutionContext());
async function account() {
  const response = await call(
    request("/api/auth/sign-up/email", "POST", {
      name: "TEST_ONLY_media_api",
      email: `media-${crypto.randomUUID()}@example.test`,
      password: "TEST_ONLY_media_password",
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const session = await call(request("/api/session", "GET", undefined, cookie));
  const identity = (
    (await session.json()) as {
      identity: { id: string; email: string; name: string };
    }
  ).identity;
  return { cookie, identity };
}
beforeEach(async () => {
  await resetMediaDatabase();
  await database.batch(
    [
      "auth_session",
      "auth_account",
      "auth_verification",
      "auth_user",
      "auth_rate_limit",
      "app_rate_limits",
    ].map((table) => database.prepare(`DELETE FROM ${table}`)),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("M-1 authenticated API dispatch, OFF recovery and no real adapter", () => {
  it("M-2 adapter configuration errors do not prevent cancellation or precede invalid JSON validation", async () => {
    const alice = await account(),
      driver = mediaDriver();
    const job = await submitMedia(
      { env: MEDIA_ENV, identity: alice.identity, driver },
      mediaInput(),
    );
    const config = {
      ...MEDIA_ENV,
      MEDIA_BUCKET: MEDIA_ENV.RAG_BUCKET,
      MEDIA_VERIFIED_IMAGE_MODELS: "[]",
    };
    const cancellation = await call(
      request(`/api/media/jobs/${job.id}/cancel`, "POST", {}, alice.cookie),
      config,
    );
    expect(cancellation.status).toBe(200);
    expect(await cancellation.json()).toMatchObject({
      isCancellationRequested: true,
      terminalAt: null,
    });
    const invalid = await call(
      request(
        "/api/media/jobs",
        "POST",
        mediaInput(0, { prompt: "x", unexpected: true }),
        alice.cookie,
      ),
      config,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_input" });
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(driver.cancel).not.toHaveBeenCalled();
  });
  it("M-2 upload/list/file/delete use the real session owner and stay private", async () => {
    const alice = await account(),
      bob = await account(),
      bytes = await syntheticPng(16, 16);
    const reservation = await call(
      request(
        "/api/media/assets",
        "POST",
        { bytes: bytes.length, contentType: "image/png" },
        alice.cookie,
      ),
    );
    expect(reservation.status).toBe(201);
    const { id, uploadPath } = (await reservation.json()) as {
      id: string;
      uploadPath: string;
    };
    const uploaded = await call(
      new Request(`${ORIGIN}${uploadPath}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: alice.cookie,
          "Content-Type": "image/png",
        },
        body: bytes,
      }),
    );
    expect(uploaded.status).toBe(200);
    for (const method of ["GET", "HEAD", "DELETE"]) {
      const response = await call(
        request(
          `/api/media/assets/${id}${method === "DELETE" ? "" : "/file"}`,
          method,
          undefined,
          bob.cookie,
        ),
      );
      expect(response.status).toBe(404);
      expect(response.headers.has("Content-Length")).toBe(false);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    const file = await call(
      request(`/api/media/assets/${id}/file`, "HEAD", undefined, alice.cookie),
    );
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("");
    expect(file.headers.get("Content-Length")).toBe(String(bytes.length));
    const listed = await call(
      request("/api/media/assets", "GET", undefined, alice.cookie),
    );
    expect(listed.status).toBe(200);
    expect(await listed.text()).not.toMatch(
      /object_key|token|TEST_ONLY_dummy_fal_key/,
    );
    expect(
      (
        await call(
          request(`/api/media/assets/${id}`, "DELETE", undefined, alice.cookie),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          request(
            `/api/media/assets/${id}/file`,
            "GET",
            undefined,
            alice.cookie,
          ),
        )
      ).status,
    ).toBe(404);
  });
  it("M-2 OFF creation is404 before auth, while owner material retrieval/deletion remain available", async () => {
    const alice = await account(),
      asset = await savedMediaImage(
        await syntheticPng(16, 16),
        "image/png",
        alice.identity,
      );
    const off = {
      ...MEDIA_ENV,
      ENABLE_MEDIA: "false",
      MEDIA_ALLOWED_MODELS: "[]",
      FAL_KEY: undefined,
    };
    expect(
      (await call(request("/api/media/assets", "POST", {}), off)).status,
    ).toBe(404);
    expect(
      (
        await call(
          request(`/api/media/assets/${asset.id}/file`, "PUT", {}),
          off,
        )
      ).status,
    ).toBe(404);
    const file = await call(
      request(
        `/api/media/assets/${asset.id}/file`,
        "GET",
        undefined,
        alice.cookie,
      ),
      off,
    );
    expect(file.status).toBe(200);
    await file.body?.cancel();
    expect(
      (
        await call(
          request(
            `/api/media/assets/${asset.id}`,
            "DELETE",
            undefined,
            alice.cookie,
          ),
          off,
        )
      ).status,
    ).toBe(200);
  });
  it("M-2 missing upstream proof/configured empty proof rejects before reservation and external calls", async () => {
    const alice = await account(),
      network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    const config = { ...MEDIA_ENV, MEDIA_VERIFIED_IMAGE_MODELS: "[]" };
    const response = await call(
      request("/api/media/jobs", "POST", mediaInput(), alice.cookie),
      config,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "media_upstream_unverified",
    });
    expect(network).not.toHaveBeenCalled();
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 0 });
  });
  it("M-2 grant path never bypasses token checks via slashes/encoding/legacy staging/other hosts", async () => {
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    for (const path of [
      "/api/media-source",
      "/api/media-source/",
      "/api/media-source//id",
      "/api/media-source/id/",
      "/api/media%2Dsource/id",
      "/api/media-source/id?token=invalid",
    ]) {
      const response = await call(new Request(ORIGIN + path));
      expect(response.status).toBe(404);
    }
    const other = await call(
      new Request("https://foreign.example.invalid/api/media-source/id"),
    );
    expect(other.status).toBe(503);
    const legacy: MediaEnv = {
      ...MEDIA_ENV,
      APP_ENV: "staging",
      APP_ORIGIN: "https://legacy.example.invalid",
      STAGING_POLICY: undefined,
    };
    const blocked = await call(
      new Request("https://legacy.example.invalid/api/media-source/id"),
      legacy,
    );
    expect(blocked.status).toBe(404);
    expect(blocked.headers.get("Cache-Control")).toBe("private, no-store");
    expect(network).not.toHaveBeenCalled();
  });
  it("OFF creation/model catalog is404 before auth; metadata recovery still needs authentication", async () => {
    const config = {
      ...MEDIA_ENV,
      ENABLE_MEDIA: "false",
      MEDIA_ALLOWED_MODELS: "[]",
      FAL_KEY: undefined,
    };
    for (const [path, method] of [
      ["/api/media/models", "GET"],
      ["/api/media/jobs", "POST"],
    ]) {
      const response = await call(
        request(path, method, method === "POST" ? {} : undefined),
        config,
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect((await call(request("/api/media/jobs"), config)).status).toBe(401);
  });
  it("lists only allowed models and explicitly reports adapters unavailable; no fetch or reservation", async () => {
    const alice = await account();
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    const config = {
      ...MEDIA_ENV,
      MEDIA_ALLOWED_MODELS: JSON.stringify([
        MEDIA_MODEL_IDS[0],
        MEDIA_MODEL_IDS[4],
      ]),
    };
    const response = await call(
      request("/api/media/models", "GET", undefined, alice.cookie),
      config,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const models = (
      (await response.json()) as {
        models: { id: string; isExecutable: boolean }[];
      }
    ).models;
    expect(models.map((model) => model.id)).toEqual([
      MEDIA_MODEL_IDS[0],
      MEDIA_MODEL_IDS[4],
    ]);
    expect(models.every((model) => !model.isExecutable)).toBe(true);
    const submission = await call(
      request("/api/media/jobs", "POST", mediaInput(), alice.cookie),
      config,
    );
    expect(submission.status).toBe(503);
    expect(await submission.json()).toEqual({
      error: "media_adapter_not_ready",
    });
    expect(network).not.toHaveBeenCalled();
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 0 });
  });
  it("checks method/origin/content type/body size/unknown keys and never falls back", async () => {
    const alice = await account();
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    const cases: [Request, number][] = [
      [
        new Request(`${ORIGIN}/api/media/jobs`, {
          method: "POST",
          headers: {
            Origin: ORIGIN,
            Cookie: alice.cookie,
            "Content-Type": "application/json",
          },
          body: new Uint8Array([
            ...new TextEncoder().encode(
              JSON.stringify(
                mediaInput(0, { prompt: "TEST_UTF8_MARKER" }),
              ).split("TEST_UTF8_MARKER")[0],
            ),
            255,
            ...new TextEncoder().encode(
              JSON.stringify(
                mediaInput(0, { prompt: "TEST_UTF8_MARKER" }),
              ).split("TEST_UTF8_MARKER")[1],
            ),
          ]),
        }),
        400,
      ],
      [request("/api/media/jobs", "PUT", {}, alice.cookie), 405],
      [
        request("/api/media/jobs", "POST", mediaInput(), alice.cookie, {
          Origin: "https://foreign.example.invalid",
        }),
        403,
      ],
      [
        request("/api/media/jobs", "POST", mediaInput(), alice.cookie, {
          "Content-Type": "text/plain",
        }),
        415,
      ],
      [
        request("/api/media/jobs", "POST", mediaInput(), alice.cookie, {
          "Content-Encoding": "gzip",
        }),
        415,
      ],
      [
        request(
          "/api/media/jobs",
          "POST",
          { ...mediaInput(), model: "arbitrary" },
          alice.cookie,
        ),
        400,
      ],
      [
        request(
          "/api/media/jobs",
          "POST",
          { ...mediaInput(), owner: "forged" },
          alice.cookie,
        ),
        400,
      ],
      [
        request(
          "/api/media/jobs",
          "POST",
          mediaInput(0, { prompt: "x", num_images: 10 }),
          alice.cookie,
        ),
        400,
      ],
      [
        request(
          "/api/media/jobs",
          "POST",
          mediaInput(0, { prompt: "x".repeat(17000) }),
          alice.cookie,
        ),
        413,
      ],
      [
        request("/api/media/jobs/not-a-job", "GET", undefined, alice.cookie),
        404,
      ],
      [request("/api/media/unknown", "GET", undefined, alice.cookie), 404],
    ];
    for (const [input, status] of cases) {
      const response = await call(input);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(network).not.toHaveBeenCalled();
  });
  it("uses the real session owner for read/erase/cancel even OFF or misconfigured, never leaks hashes or keys", async () => {
    const alice = await account();
    const bob = await account();
    const driver = mediaDriver();
    const job = await submitMedia(
      { env: MEDIA_ENV, identity: alice.identity, driver },
      mediaInput(),
    );
    const off = {
      ...MEDIA_ENV,
      ENABLE_MEDIA: "false",
      MEDIA_ALLOWED_MODELS: "[]",
      FAL_KEY: undefined,
    };
    for (const method of ["GET", "DELETE"])
      expect(
        (
          await call(
            request(`/api/media/jobs/${job.id}`, method, undefined, bob.cookie),
            off,
          )
        ).status,
      ).toBe(404);
    expect(
      (
        await call(
          request(`/api/media/jobs/${job.id}/cancel`, "POST", {}, bob.cookie),
          off,
        )
      ).status,
    ).toBe(404);
    const fetched = await call(
      request(`/api/media/jobs/${job.id}`, "GET", undefined, alice.cookie),
      { ...off, MEDIA_ALLOWED_MODELS: "bad" },
    );
    expect(fetched.status).toBe(200);
    const text = await fetched.text();
    expect(text).not.toMatch(
      /input_hash|object_key|TEST_ONLY_dummy_fal_key|provider_id/,
    );
    const erased = await call(
      request(`/api/media/jobs/${job.id}`, "DELETE", undefined, alice.cookie),
      off,
    );
    expect(erased.status).toBe(200);
    expect(await erased.json()).toMatchObject({
      input: null,
      bodyAvailable: false,
      terminalAt: null,
    });
    const listed = await call(
      request("/api/media/jobs", "GET", undefined, alice.cookie),
      off,
    );
    expect(listed.status).toBe(200);
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(driver.cancel).not.toHaveBeenCalled();
    await eraseMediaBody(MEDIA_ENV, alice.identity, job.id);
  });
  it("legacy verification staging blocks all media before authentication or any upstream fetch", async () => {
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    const config: MediaEnv = {
      ...MEDIA_ENV,
      APP_ENV: "staging",
      APP_ORIGIN: "https://legacy.example.invalid",
      STAGING_POLICY: undefined,
    };
    for (const path of [
      "/api/media/models",
      "/api/media/jobs",
      `/api/media/jobs/${crypto.randomUUID()}/cancel`,
    ]) {
      const response = await call(
        new Request(`${config.APP_ORIGIN}${path}`, { method: "POST" }),
        config,
      );
      expect(response.status).toBe(404);
    }
    expect(network).not.toHaveBeenCalled();
  });
});
