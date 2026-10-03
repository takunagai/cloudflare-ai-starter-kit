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
