import { createExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIO_ENDPOINTS } from "../src/lib/media-audio-options";
import { IMAGE_ENDPOINTS } from "../src/lib/media-image-options";
import { VIDEO_ENDPOINTS } from "../src/lib/media-video-options";
import api from "../src/server/api";
import { ownedAsset } from "../src/server/media/assets";
import { MEDIA_MODEL_IDS } from "../src/server/media/catalog";
import type { MediaEnv } from "../src/server/media/policy";
import {
  allowNextMediaPoll,
  MEDIA_DATABASE as DATABASE,
  MEDIA_ENV,
  mediaInput,
  resetMediaDatabase,
} from "./media-fixtures";
import { savedMediaImage, syntheticPng } from "./media-image-fixtures";
import {
  createMediaIntegrationFake,
  integrationInput,
} from "./media-integration-fake";

const ORIGIN = "http://127.0.0.1:3000";
const CONFIGURATION: MediaEnv = {
  ...MEDIA_ENV,
  MEDIA_VERIFIED_IMAGE_MODELS: JSON.stringify(IMAGE_ENDPOINTS),
  MEDIA_VERIFIED_VIDEO_MODELS: JSON.stringify(VIDEO_ENDPOINTS),
  MEDIA_VERIFIED_AUDIO_MODELS: JSON.stringify(AUDIO_ENDPOINTS),
};
function call(
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
  configuration = CONFIGURATION,
  extraHeaders: HeadersInit = {},
) {
  return api.fetch(
    new Request(ORIGIN + path, {
      method,
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    configuration,
    createExecutionContext(),
  );
}
async function account() {
  const response = await call("/api/auth/sign-up/email", "", "POST", {
    name: "TEST_ONLY M5",
    email: `m5-${crypto.randomUUID()}@example.test`,
    password: "TEST_ONLY_m5_password",
  });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const session = (await (await call("/api/session", cookie)).json()) as {
    identity: { id: string; email: string; name: string };
  };
  return { cookie, identity: session.identity };
}
beforeEach(async () => {
  await resetMediaDatabase();
  await DATABASE.batch(
    [
      "auth_session",
      "auth_account",
      "auth_verification",
      "auth_user",
      "auth_rate_limit",
      "app_rate_limits",
    ].map((table) => DATABASE.prepare(`DELETE FROM ${table}`)),
  );
});
afterEach(() => vi.unstubAllGlobals());
const CASES = MEDIA_MODEL_IDS.map((model, index) => ({ model, index }));
async function complete(cookie: string, raw: ReturnType<typeof mediaInput>) {
  const response = await call("/api/media/jobs", cookie, "POST", raw);
  expect(response.status).toBe(202);
  const job = (await response.json()) as { id: string };
  await allowNextMediaPoll(job.id);
  const refreshed = await call(
    `/api/media/jobs/${job.id}/refresh`,
    cookie,
    "POST",
    {},
  );
  expect(refreshed.status).toBe(200);
  expect(await refreshed.json()).toMatchObject({ terminalOutcome: "stored" });
  return (await (await call(`/api/media/jobs/${job.id}`, cookie)).json()) as {
    id: string;
    assets: { id: string }[];
    terminalAt: number;
  };
}
describe("M-5 all twelve adapters through authenticated shared API and isolated D1/R2", () => {
  it.each(CASES)(
    "$model: dispatch, fixed transport, private result, replay, ownership and deletion",
    async ({ model, index }) => {
      const alice = await account(),
        bob = await account();
      const fake = createMediaIntegrationFake(() => CONFIGURATION);
      vi.stubGlobal("fetch", fake.transport);
      const reference =
        (index % 2 && index < 4) || (index > 4 && index < 8)
          ? await savedMediaImage(
              await syntheticPng(),
              "image/png",
              alice.identity,
              CONFIGURATION,
            )
          : undefined;
      const raw = mediaInput(index, integrationInput(index, reference?.id));
      const detail = await complete(alice.cookie, raw);
      const asset = await ownedAsset(
        DATABASE,
        alice.identity.id,
        detail.assets[0].id,
      );
      expect(asset.source).toBe("result");
      expect(asset.expires_at - asset.validated_at).toBe(30 * 86400000);
      expect(fake.submissions.map((entry) => entry.model)).toEqual([model]);
      expect(fake.downloadCount()).toBe(1);
      expect(
        await (await call("/api/media/jobs", alice.cookie, "POST", raw)).json(),
      ).toMatchObject({ id: detail.id });
      expect(
        (
          await call("/api/media/jobs", alice.cookie, "POST", {
            ...raw,
            input: {
              ...raw.input,
              ...(index === 8 || index === 10
                ? { text: "changed" }
                : index === 9
                  ? { instruction: "changed" }
                  : { prompt: "changed" }),
            },
          })
        ).status,
      ).toBe(409);
      expect(fake.submissions).toHaveLength(1);
      expect(
        await DATABASE.prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
          .bind(detail.id)
          .first(),
      ).toEqual({ held_bytes: asset.bytes });
      expect(
        await DATABASE.prepare(
          "SELECT count(*) AS n FROM media_usage_events WHERE job_id=?",
        )
          .bind(detail.id)
          .first(),
      ).toEqual({ n: 1 });
      const path = `/api/media/assets/${asset.id}/file`;
      for (const cookie of ["", bob.cookie]) {
        const response = await call(
          path,
          cookie,
          "GET",
          undefined,
          CONFIGURATION,
          { Range: "bytes=0-31" },
        );
        expect(response.status).toBe(cookie ? 404 : 401);
        expect(response.headers.has("ETag")).toBe(false);
        expect(response.headers.has("Content-Length")).toBe(false);
      }
      const head = await call(path, alice.cookie, "HEAD");
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(head.headers.get("Cache-Control")).toBe("private, no-store");
      if (index >= 4) {
        const range = await call(
          path,
          alice.cookie,
          "GET",
          undefined,
          CONFIGURATION,
          { Range: "bytes=-32", "If-Range": head.headers.get("ETag") ?? "" },
        );
        expect(range.status).toBe(206);
        expect((await range.arrayBuffer()).byteLength).toBe(32);
      }
      expect(
        (await call(`/api/media/assets/${asset.id}`, bob.cookie, "DELETE"))
          .status,
      ).toBe(404);
      expect(
        (await call(`/api/media/assets/${asset.id}`, alice.cookie, "DELETE"))
          .status,
      ).toBe(200);
      expect((await call(path, alice.cookie)).status).toBe(404);
      expect(
        await DATABASE.prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
          .bind(detail.id)
          .first(),
      ).toEqual({ held_bytes: 0 });
    },
  );
  it.each(CASES)(
    "$model: missing its own upstream gate makes no reservation or external request",
    async ({ index }) => {
      const alice = await account(),
        network = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", network);
      const configuration = {
        ...CONFIGURATION,
        [index < 4
          ? "MEDIA_VERIFIED_IMAGE_MODELS"
          : index < 8
            ? "MEDIA_VERIFIED_VIDEO_MODELS"
            : "MEDIA_VERIFIED_AUDIO_MODELS"]: "[]",
      };
      const response = await call(
        "/api/media/jobs",
        alice.cookie,
        "POST",
        mediaInput(index, integrationInput(index, crypto.randomUUID())),
        configuration,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "media_upstream_unverified",
      });
      expect(network).not.toHaveBeenCalled();
      expect(
        await DATABASE.prepare("SELECT count(*) AS n FROM media_jobs").first(),
      ).toEqual({ n: 0 });
    },
  );
  it.each(CASES)(
    "$model: explicit allowed-model exclusion rejects before transport or reservation",
    async ({ model, index }) => {
      const alice = await account(),
        network = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", network);
      const configuration = {
        ...CONFIGURATION,
        MEDIA_ALLOWED_MODELS: JSON.stringify(
          MEDIA_MODEL_IDS.filter((id) => id !== model),
        ),
      };
      const response = await call(
        "/api/media/jobs",
        alice.cookie,
        "POST",
        mediaInput(index, integrationInput(index, crypto.randomUUID())),
        configuration,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "media_model_not_allowed",
      });
      expect(network).not.toHaveBeenCalled();
      expect(
        await DATABASE.prepare("SELECT count(*) AS n FROM media_jobs").first(),
      ).toEqual({ n: 0 });
    },
  );
  it.each([5, 6, 7])(
    "generated image reused by video %s retains ID/version/first expiry and revokes completed grant",
    async (index) => {
      const alice = await account(),
        fake = createMediaIntegrationFake(() => CONFIGURATION);
      vi.stubGlobal("fetch", fake.transport);
      const image = await complete(
        alice.cookie,
        mediaInput(0, integrationInput(0)),
      );
      const original = await ownedAsset(
        DATABASE,
        alice.identity.id,
        image.assets[0].id,
      );
      await complete(
        alice.cookie,
        mediaInput(index, integrationInput(index, original.id)),
      );
      expect(
        await ownedAsset(DATABASE, alice.identity.id, original.id),
      ).toEqual(original);
      expect(fake.submissions.map((entry) => entry.model)).toEqual([
        MEDIA_MODEL_IDS[0],
        MEDIA_MODEL_IDS[index],
      ]);
      const last = fake.submissions.at(-1)?.input;
      const source = String(last?.image_url ?? last?.end_image_url);
      // 上流だけへ渡った短期URLを出力せず、終端後の取得拒否を確認。
      const blocked = await api.fetch(
        new Request(source),
        CONFIGURATION,
        createExecutionContext(),
      );
      expect(blocked.status).toBe(404);
    },
  );
  it("uncertain image submission keeps shared owner slot/capacity and blocks video/audio without fallback", async () => {
    const alice = await account(),
      fake = createMediaIntegrationFake(() => CONFIGURATION, {
        hasUnknownSubmission: true,
      });
    vi.stubGlobal("fetch", fake.transport);
    const response = await call(
      "/api/media/jobs",
      alice.cookie,
      "POST",
      mediaInput(0, integrationInput(0)),
    );
    expect(response.status).toBe(502);
    const listed = (await (
      await call("/api/media/jobs", alice.cookie)
    ).json()) as {
      jobs: { id: string; providerState: string }[];
    };
    const job = listed.jobs[0];
    expect(job.providerState).toBe("submission_unknown");
    for (const index of [4, 8, 11])
      expect(
        (
          await call(
            "/api/media/jobs",
            alice.cookie,
            "POST",
            mediaInput(index, integrationInput(index)),
          )
        ).status,
      ).toBe(429);
    expect(fake.submissions).toHaveLength(1);
    expect(
      await DATABASE.prepare(
        "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
      )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 20 * 1024 * 1024 });
    expect(
      (await call(`/api/media/jobs/${job.id}/cancel`, alice.cookie, "POST", {}))
        .status,
    ).toBe(200);
    expect(
      (
        await call(
          "/api/media/jobs",
          alice.cookie,
          "POST",
          mediaInput(10, integrationInput(10)),
        )
      ).status,
    ).toBe(429);
  });
  it("all OFF needs neither a fal key nor an extra R2 binding and still authenticates metadata", async () => {
    const configuration = {
      ...MEDIA_ENV,
      ENABLE_MEDIA: "false",
      MEDIA_ALLOWED_MODELS: "[]",
      FAL_KEY: undefined,
      MEDIA_BUCKET: undefined,
    };
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    expect(
      (await call("/api/health", "", "GET", undefined, configuration)).status,
    ).toBe(200);
    for (const index of CASES)
      expect(
        (
          await call(
            "/api/media/jobs",
            "",
            "POST",
            mediaInput(index.index),
            configuration,
          )
        ).status,
      ).toBe(404);
    expect(
      (await call("/api/media/models", "", "GET", undefined, configuration))
        .status,
    ).toBe(404);
    expect(
      (await call("/api/media/jobs", "", "GET", undefined, configuration))
        .status,
    ).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
});
