import { env } from "cloudflare:test";
import { vi } from "vitest";
import type { Identity } from "../src/server/env";
import { MEDIA_MODEL_IDS } from "../src/server/media/catalog";
import type { MediaJob } from "../src/server/media/ledger";
import type { MediaEnv } from "../src/server/media/policy";
import type { MediaDriver, MediaReceipt } from "../src/server/media/service";

export const MEDIA_DATABASE = env.DB as D1Database;
export const MEDIA_ENV = {
  ...env,
  DB: MEDIA_DATABASE,
  ENABLE_MEDIA: "true",
  MEDIA_ALLOWED_MODELS: JSON.stringify(MEDIA_MODEL_IDS),
  FAL_KEY: "TEST_ONLY_dummy_fal_key",
} as MediaEnv;
export const MEDIA_ALICE: Identity = {
  id: "TEST_ONLY_media_alice",
  email: "media-alice@example.test",
  name: "Test",
};
export const MEDIA_BOB: Identity = {
  id: "TEST_ONLY_media_bob",
  email: "media-bob@example.test",
  name: "Test",
};
export async function resetMediaDatabase() {
  await MEDIA_DATABASE.batch([
    ...[
      "media_asset_grants",
      "media_uploads",
      "media_output_objects",
      "media_job_assets",
      "media_job_bodies",
      "media_usage_events",
      "media_storage_reservations",
      "media_jobs",
      "media_assets",
      "image_jobs",
    ].map((table) => MEDIA_DATABASE.prepare(`DELETE FROM ${table}`)),
    MEDIA_DATABASE.prepare(
      "UPDATE media_runtime_state SET is_recovery_blocked=0 WHERE id=1",
    ),
  ]);
}
export function mediaInput(
  index = 0,
  input?: Record<string, unknown>,
  requestId = `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
) {
  return {
    requestId,
    model: MEDIA_MODEL_IDS[index],
    input:
      input ??
      (index < 4
        ? { prompt: "TEST_ONLY_image" }
        : index < 8
          ? { prompt: "TEST_ONLY_video" }
          : index < 10
            ? { mode: "single", text: "TEST_ONLY_speech" }
            : index === 10
              ? { text: "TEST_ONLY_speech", voice: "Rachel" }
              : { prompt: "TEST_ONLY_music" }),
  };
}
export function mediaReceipts(job: Readonly<MediaJob>): MediaReceipt[] {
  return Array.from(
    { length: job.kind === "image" ? job.quantity : 1 },
    (_, ordinal) => ({
      id: crypto.randomUUID(),
      ordinal,
      objectKey: `media/results/${job.id}/${ordinal}`,
      format:
        job.kind === "image"
          ? "png"
          : job.kind === "video"
            ? "mp4"
            : job.model_id.startsWith("google/")
              ? "wav"
              : "mp3",
      bytes: 1024,
      ...(job.kind === "image"
        ? { width: 1024, height: 1024 }
        : job.kind === "video"
          ? { width: 1366, height: 768, duration: job.quantity }
          : { duration: 5 }),
      validatedAt: Date.now(),
    }),
  );
}
export function mediaDriver() {
  const receipts = new Map<string, MediaReceipt[]>();
  return {
    submit: vi.fn<MediaDriver["submit"]>(async () => ({
      outcome: "accepted",
      requestId: "TEST_ONLY_provider_request",
    })),
    status: vi.fn<MediaDriver["status"]>(async () => "completed"),
    cancel: vi.fn<MediaDriver["cancel"]>(async () => {}),
    collect: vi.fn<MediaDriver["collect"]>(async (job) => {
      const assets = receipts.get(job.id) ?? mediaReceipts(job);
      receipts.set(job.id, assets);
      return { assets, isComplete: true, hasInvalidOutput: false };
    }),
    discard: vi.fn<MediaDriver["discard"]>(async () => {}),
  } satisfies MediaDriver;
}
export async function allowNextMediaPoll(id: string) {
  await MEDIA_DATABASE.prepare(
    "UPDATE media_jobs SET next_poll_at=0 WHERE id=?",
  )
    .bind(id)
    .run();
}
export async function syntheticReference(
  owner: string,
  options: {
    bytes?: number;
    format?: string;
    hasAlpha?: boolean;
    expiresAt?: number;
  } = {},
) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await MEDIA_DATABASE.prepare(
    "INSERT INTO media_assets(id,owner_id,object_key,version,source,format,bytes,width,height,has_alpha,state,validated_at,expires_at) VALUES(?,?,?,1,'upload',?,?,1024,1024,?,'ready',?,?)",
  )
    .bind(
      id,
      owner,
      `TEST_ONLY_upload/${id}`,
      options.format ?? "png",
      options.bytes ?? 1024,
      options.hasAlpha ? 1 : 0,
      now,
      options.expiresAt ?? now + 7 * 86400000,
    )
    .run();
  return id;
}
