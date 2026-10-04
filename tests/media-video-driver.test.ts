import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEO_ENDPOINTS } from "../src/lib/media-video-options";
import { assetFile, deleteAsset, ownedAsset } from "../src/server/media/assets";
import { normalizeMedia } from "../src/server/media/catalog";
import { handleMediaSource } from "../src/server/media/grants";
import { ownedMediaJob } from "../src/server/media/ledger";
import type { MediaEnv } from "../src/server/media/policy";
import {
  advanceMediaJob,
  getMediaJob,
  requestMediaCancellation,
  resumeMediaCollection,
  submitMedia,
} from "../src/server/media/service";
import {
  createVideoDriver,
  videoAdapterReady,
  videoProviderInput,
} from "../src/server/media/video-driver";
import {
  MEDIA_ALICE as ALICE,
  allowNextMediaPoll,
  MEDIA_BOB as BOB,
  MEDIA_DATABASE as DATABASE,
  MEDIA_ENV,
  mediaInput,
  resetMediaDatabase,
} from "./media-fixtures";
import { savedMediaImage, syntheticPng } from "./media-image-fixtures";
import { SYNTHETIC_MP4 } from "./media-video-fixtures";
import { HIGH_PROFILE_VIDEOS } from "./media-video-high-fixtures";

const CONFIG = {
  ...MEDIA_ENV,
  MEDIA_VERIFIED_VIDEO_MODELS: JSON.stringify(VIDEO_ENDPOINTS),
} as MediaEnv & { MEDIA_BUCKET: R2Bucket };
beforeEach(resetMediaDatabase);
async function fixture(
  options: {
    url?: string;
    mime?: string;
    length?: string;
    bytes?: Uint8Array<ArrayBuffer>;
    isDisconnected?: boolean;
    isOverrun?: boolean;
    isUnderrun?: boolean;
    isLateCancel?: boolean;
    isRedirect?: boolean;
    isWaiting?: boolean;
  } = {},
) {
  const bytes = options.bytes ?? SYNTHETIC_MP4;
  const streamBytes = options.isOverrun
    ? new Uint8Array([...bytes, 0])
    : options.isUnderrun
      ? bytes.slice(0, -1)
      : bytes;
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    expect(init?.redirect).toBe("error");
    if (url.startsWith("https://queue.fal.run/")) {
      if (init?.method === "POST") {
        const submitted = JSON.parse(String(init.body));
        for (const source of [
          ...(submitted.reference_image_urls ?? []),
          ...[submitted.image_url, submitted.end_image_url].filter(Boolean),
        ]) {
          const reference = await handleMediaSource(
            new Request(source),
            CONFIG,
          );
          expect(reference.status).toBe(200);
          await reference.body?.cancel();
        }
        return Response.json({
          request_id: "TEST_ONLY_video_request",
          response_url: "https://forged.example.invalid/",
        });
      }
      if (url.endsWith("/cancel"))
        return Response.json({ status: "COMPLETED" });
      if (url.endsWith("/status"))
        return Response.json({
          status: options.isWaiting ? "IN_QUEUE" : "COMPLETED",
        });
      return Response.json({
        video: {
          url:
            options.url ?? "https://v3b.fal.media/files/b/TEST_ONLY/video.mp4",
          content_type: "video/mp4",
          file_size: bytes.length,
        },
      });
    }
    if (url.startsWith("https://rest.fal.ai/"))
      return Response.json({
        token: "TEST_ONLY_video_cdn_token",
        expires_at: new Date(Date.now() + 300000).toISOString(),
      });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer TEST_ONLY_video_cdn_token",
    );
    if (options.isRedirect) return new Response(null, { status: 302 });
    let offset = 0;
    return new Response(
      new ReadableStream({
        async pull(controller) {
          if (options.isLateCancel && offset === 0) {
            const job = await DATABASE.prepare(
              "SELECT id FROM media_jobs WHERE owner_id=?",
            )
              .bind(ALICE.id)
              .first<{ id: string }>();
            await requestMediaCancellation(CONFIG, ALICE, job?.id ?? "");
          }
          if (options.isDisconnected && offset > 0) {
            controller.error(new Error("TEST_ONLY_disconnect"));
            return;
          }
          if (offset === streamBytes.length) {
            controller.close();
            return;
          }
          const end = Math.min(streamBytes.length, offset + 137);
          controller.enqueue(streamBytes.slice(offset, end));
          offset = end;
        },
      }),
      {
        headers: {
          "Content-Type": options.mime ?? "video/mp4",
          "Content-Length": options.length ?? String(bytes.length),
        },
      },
    );
  });
  const driver = createVideoDriver(CONFIG, transport),
    context = { env: CONFIG, identity: ALICE, driver };
  return { bytes, driver, transport, context };
}
async function request(index = 4) {
  const reference =
    index === 4 ? null : await savedMediaImage(await syntheticPng(1024, 1024));
  return mediaInput(index, {
    prompt: "TEST_ONLY_video",
    duration: 5,
    resolution: "480P",
    ...(index === 4
      ? { aspectRatio: "1:1" }
      : index === 5
        ? { end: reference?.id }
        : index === 6
          ? {
              references: [reference?.id],
              start: reference?.id,
              aspectRatio: "adaptive",
            }
          : {
              start: reference?.id,
              keyframes: [
                { time: 0, azimuth: 0, elevation: 0, distance: 1 },
                { time: 1, azimuth: 90, elevation: 0, distance: 1 },
              ],
            }),
  });
}
async function output(options: Parameters<typeof fixture>[0] = {}) {
  const test = await fixture(options),
    job = await submitMedia(test.context, await request());
  await allowNextMediaPoll(job.id);
  const result = await advanceMediaJob(test.context, job.id);
  const detail = await getMediaJob(CONFIG, ALICE, job.id);
  return { ...test, job, result, detail };
}
describe("M-3 four fixed video adapters; fake upstream, isolated workerd D1/R2", () => {
  it.each(
    HIGH_PROFILE_VIDEOS.flatMap((video) =>
      [4, 5, 6, 7].map((index) => ({ ...video, index })),
    ),
  )(
    "inspects/stores/replays 10s High $name on endpoint $index",
    async (video) => {
      const test = await fixture({ bytes: video.bytes });
      const reference =
        video.index === 4
          ? null
          : await savedMediaImage(
              await syntheticPng(video.width, video.height),
            );
      const raw = mediaInput(video.index, {
        prompt: "TEST_ONLY_high_profile",
        duration: 10,
        resolution: video.resolution,
        seed: 0,
        ...(video.index === 4
          ? { aspectRatio: video.aspectRatio }
          : video.index === 5
            ? { start: reference?.id }
            : video.index === 6
              ? {
                  references: [reference?.id],
                  end: reference?.id,
                  aspectRatio: video.aspectRatio,
                }
              : {
                  start: reference?.id,
                  keyframes: [
                    { time: 0, azimuth: 0, elevation: 0, distance: 1 },
                    { time: 1, azimuth: -90, elevation: 15, distance: 0.7 },
                  ],
                }),
      });
      const job = await submitMedia(test.context, raw);
      const submitted = test.transport.mock.calls.find(
        ([url, options]) =>
          String(url).startsWith("https://queue.fal.run/") &&
          options?.method === "POST",
      );
      expect(submitted?.[0]).toBe(
        `https://queue.fal.run/${VIDEO_ENDPOINTS[video.index - 4]}`,
      );
      expect(JSON.parse(String(submitted?.[1]?.body))).toMatchObject({
        duration: 10,
        resolution: video.resolution,
        seed: 0,
      });
      await allowNextMediaPoll(job.id);
      expect(await advanceMediaJob(test.context, job.id)).toMatchObject({
        terminalOutcome: "stored",
      });
      const detail = await getMediaJob(CONFIG, ALICE, job.id),
        asset = await ownedAsset(DATABASE, ALICE.id, detail.assets[0].id);
      expect(asset).toMatchObject({
        state: "ready",
        format: "mp4",
        width: video.width,
        height: video.height,
        duration: 10,
        bytes: video.bytes.length,
      });
      expect(asset.expires_at - asset.validated_at).toBe(30 * 86400000);
      const object = await CONFIG.MEDIA_BUCKET.get(asset.object_key);
      if (!object) throw new Error("TEST_ONLY_private_object_missing");
      expect(object?.httpMetadata).toMatchObject({
        contentType: "video/mp4",
        cacheControl: "private, no-store",
      });
      expect(new Uint8Array(await object.arrayBuffer())).toEqual(video.bytes);
      expect(
        await DATABASE.prepare(
          "SELECT quantity FROM media_usage_events WHERE job_id=?",
        )
          .bind(job.id)
          .first(),
      ).toEqual({ quantity: 10 });
      expect(
        await DATABASE.prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
          .bind(job.id)
          .first(),
      ).toEqual({ held_bytes: video.bytes.length });
      expect((await submitMedia(test.context, raw)).id).toBe(job.id);
      const replay = await test.driver.collect(
        await ownedMediaJob(DATABASE, ALICE.id, job.id),
        new AbortController().signal,
      );
      expect(replay.assets[0]).toMatchObject({
        id: asset.id,
        validatedAt: asset.validated_at,
        width: video.width,
        height: video.height,
        duration: 10,
      });
      expect(
        test.transport.mock.calls.filter(
          ([url, options]) =>
            String(url).startsWith("https://queue.fal.run/") &&
            options?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(
        test.transport.mock.calls.filter(([url]) =>
          String(url).endsWith("/video.mp4"),
        ),
      ).toHaveLength(1);
      const response = await assetFile(
        new Request(`http://127.0.0.1:3000/api/media/assets/${asset.id}/file`, {
          headers: { Range: "bytes=-256" },
        }),
        CONFIG,
        ALICE,
        asset.id,
      );
      expect(response.status).toBe(206);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        video.bytes.slice(-256),
      );
    },
  );
  it.each([4, 5, 6, 7])(
    "maps endpoint %s, scoped start/end/reference grant and private validated MP4 once",
    async (index) => {
      const { context, transport } = await fixture(),
        raw = await request(index);
      const [job, duplicate] = await Promise.all([
        submitMedia(context, raw),
        submitMedia(context, raw),
      ]);
      expect(job.id).toBe(duplicate.id);
      const calls = transport.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith("https://queue.fal.run/") &&
          init?.method === "POST",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe(
        `https://queue.fal.run/${VIDEO_ENDPOINTS[index - 4]}`,
      );
      const input = JSON.parse(String(calls[0][1]?.body));
      expect(input).toMatchObject({
        duration: 5,
        resolution: "480P",
        sync_mode: false,
        enable_safety_checker: true,
        prompt_expansion_mode: "disabled",
      });
      expect(new Headers(calls[0][1]?.headers).get("X-Fal-No-Retry")).toBe("1");
      if (index === 5 || index === 7)
        expect(input).not.toHaveProperty("aspect_ratio");
      await allowNextMediaPoll(job.id);
      expect(await advanceMediaJob(context, job.id)).toMatchObject({
        terminalOutcome: "stored",
      });
      const detail = await getMediaJob(CONFIG, ALICE, job.id),
        asset = await ownedAsset(DATABASE, ALICE.id, detail.assets[0].id);
      expect(asset).toMatchObject({
        format: "mp4",
        width: 480,
        height: 480,
        duration: 5,
        bytes: SYNTHETIC_MP4.length,
        state: "ready",
      });
      expect(asset.expires_at - asset.validated_at).toBe(30 * 86400000);
      expect(JSON.stringify(detail)).not.toMatch(
        /fal\.media|cdn_token|object_key|token_hash/,
      );
      expect(
        await DATABASE.prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
          .bind(job.id)
          .first(),
      ).toEqual({ held_bytes: SYNTHETIC_MP4.length });
    },
  );
  it("preserves ordered reference URLs, end-only i2v, signed camera azimuth and seed without fallback fields", () => {
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    const media = normalizeMedia(
      mediaInput(6, {
        prompt: "x",
        references: [first, second],
        end: first,
        seed: 0,
      }),
    );
    expect(
      videoProviderInput(media, [
        { role: "reference", ordinal: 1, url: "second" },
        { role: "reference", ordinal: 0, url: "first" },
        { role: "end", ordinal: 0, url: "end" },
      ]),
    ).toMatchObject({
      reference_image_urls: ["first", "second"],
      end_image_url: "end",
      seed: 0,
      aspect_ratio: "adaptive",
    });
    expect(() => normalizeMedia(mediaInput(5))).toThrow("invalid_input");
    expect(() =>
      normalizeMedia(
        mediaInput(6, { prompt: "x", references: [first, first] }),
      ),
    ).toThrow("invalid_input");
    expect(() =>
      videoProviderInput(
        normalizeMedia(mediaInput(5, { prompt: "x", start: first })),
        [],
      ),
    ).toThrow("media_reference_invalid");
    expect(() =>
      normalizeMedia(
        mediaInput(7, {
          prompt: "x",
          start: first,
          keyframes: [
            { time: 0, azimuth: 0, elevation: 0, distance: 1 },
            { time: 1, azimuth: 721, elevation: 0, distance: 1 },
          ],
        }),
      ),
    ).toThrow("invalid_input");
  });
  it("waiting metadata survives reload/second tab without a second generation; cancellation records intent", async () => {
    const { context, transport } = await fixture({ isWaiting: true }),
      raw = await request();
    const job = await submitMedia(context, raw);
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      providerState: "queued",
      terminalAt: null,
    });
    expect(await getMediaJob(CONFIG, ALICE, job.id)).toMatchObject({
      input: normalizeMedia(raw).input,
    });
    expect((await submitMedia(context, raw)).id).toBe(job.id);
    await requestMediaCancellation(CONFIG, ALICE, job.id);
    await allowNextMediaPoll(job.id);
    await advanceMediaJob(context, job.id);
    expect(
      (await getMediaJob(CONFIG, ALICE, job.id)).isCancellationRequested,
    ).toBe(true);
    expect(
      transport.mock.calls.filter(
        ([, init]) =>
          init?.method === "POST" &&
          !String(init.body).includes("expiration_seconds"),
      ),
    ).toHaveLength(1);
  });
  it.each([
    { mime: "image/png" },
    { length: "NaN" },
    { length: String(256 * 1024 * 1024 + 1) },
    { bytes: new Uint8Array([0, 0, 0, 8, 109, 111, 111, 118]) },
    { url: "https://fal.media/public.mp4" },
    { url: "https://v3b.fal.media/files/b/TEST_ONLY/video.mp4?token=forged" },
  ])("rejects invalid output %j without success", async (options) => {
    const test = await output(options);
    expect(test.result.terminalOutcome).toBe("invalid");
    expect(test.detail.assets).toHaveLength(0);
    expect(
      await DATABASE.prepare(
        "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
      )
        .bind(test.job.id)
        .first(),
    ).toEqual({ held_bytes: 0 });
  });
  it.each([{ isOverrun: true }, { isUnderrun: true }])(
    "bounds actual stream bytes even when all declared sizes match %j",
    async (options) => {
      const test = await fixture(options),
        job = await submitMedia(test.context, await request());
      await allowNextMediaPoll(job.id);
      await expect(advanceMediaJob(test.context, job.id)).rejects.toThrow(
        "media_video_write_unknown",
      );
      expect((await getMediaJob(CONFIG, ALICE, job.id)).terminalAt).toBeNull();
      expect(
        await DATABASE.prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
          .bind(job.id)
          .first(),
      ).toEqual({ held_bytes: 256 * 1024 * 1024 });
    },
  );
  it("stream disconnect retains write-unknown and full capacity, never regenerates or releases on retry/cancel", async () => {
    const { context, transport } = await fixture({ isDisconnected: true }),
      job = await submitMedia(context, await request());
    await allowNextMediaPoll(job.id);
    await expect(advanceMediaJob(context, job.id)).rejects.toThrow(
      "media_video_write_unknown",
    );
    await expect(resumeMediaCollection(context, job.id)).rejects.toThrow();
    await requestMediaCancellation(CONFIG, ALICE, job.id);
    await allowNextMediaPoll(job.id);
    await expect(advanceMediaJob(context, job.id)).rejects.toThrow(
      "media_delete_pending",
    );
    expect(
      await DATABASE.prepare(
        "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
      )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 256 * 1024 * 1024 });
    expect(
      transport.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith("https://queue.fal.run/") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("late cancellation never publishes the written video and releases only after physical discard", async () => {
    const { context } = await fixture({ isLateCancel: true }),
      job = await submitMedia(context, await request());
    await allowNextMediaPoll(job.id);
    await expect(advanceMediaJob(context, job.id)).rejects.toThrow(
      "media_collection_unavailable",
    );
    expect((await getMediaJob(CONFIG, ALICE, job.id)).assets).toHaveLength(0);
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "discarded",
    });
    expect(
      await CONFIG.MEDIA_BUCKET.head(`media/results/${job.id}/0`),
    ).toBeNull();
  });
  it("unverified/missing/invalid video gate refuses before reservation and retains image separation", async () => {
    for (const proof of [
      undefined,
      "[]",
      "true",
      JSON.stringify([VIDEO_ENDPOINTS[0], VIDEO_ENDPOINTS[0]]),
      JSON.stringify(["openai/gpt-image-2.5/sunburst/text-to-image"]),
    ]) {
      const config = { ...CONFIG, MEDIA_VERIFIED_VIDEO_MODELS: proof },
        transport = vi.fn<typeof fetch>();
      expect(videoAdapterReady(config, VIDEO_ENDPOINTS[0])).toBe(false);
      await expect(
        submitMedia(
          {
            env: config,
            identity: ALICE,
            driver: createVideoDriver(config, transport),
          },
          await request(),
        ),
      ).rejects.toThrow("media_upstream_unverified");
      expect(transport).not.toHaveBeenCalled();
    }
    expect(
      await DATABASE.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 0 });
  });
  it("receipt recovery reuses the same privately stored object/id/expiry after a ledger failure", async () => {
    const test = await output(),
      asset = await ownedAsset(DATABASE, ALICE.id, test.detail.assets[0].id);
    const job = await ownedMediaJob(DATABASE, ALICE.id, test.job.id);
    const receipt = await test.driver.collect(
      job,
      new AbortController().signal,
    );
    expect(receipt.assets[0]).toMatchObject({
      id: asset.id,
      validatedAt: asset.validated_at,
      bytes: asset.bytes,
    });
    expect(
      test.transport.mock.calls.filter(([url]) =>
        String(url).endsWith("/video.mp4"),
      ),
    ).toHaveLength(1);
  });
  it("a failed receipt ledger batch resumes stored bytes with the same ID/time and no generation or CDN retry", async () => {
    const test = await fixture();
    let hasFailed = false;
    const context = {
      ...test.context,
      driver: {
        ...test.driver,
        async collect(...parameters: Parameters<typeof test.driver.collect>) {
          const receipt = await test.driver.collect(...parameters);
          if (!hasFailed) {
            hasFailed = true;
            vi.spyOn(DATABASE, "batch").mockRejectedValueOnce(
              new Error("TEST_ONLY_ledger_failure"),
            );
          }
          return receipt;
        },
      },
    };
    const job = await submitMedia(context, await request());
    await allowNextMediaPoll(job.id);
    try {
      await expect(advanceMediaJob(context, job.id)).rejects.toThrow(
        "media_ledger_unavailable",
      );
    } finally {
      vi.restoreAllMocks();
    }
    const saved = await DATABASE.prepare(
      "SELECT receipt_json FROM media_output_objects WHERE job_id=?",
    )
      .bind(job.id)
      .first<{ receipt_json: string }>();
    const receipt = JSON.parse(saved?.receipt_json ?? "{}");
    expect((await getMediaJob(CONFIG, ALICE, job.id)).assets).toHaveLength(0);
    expect(
      await DATABASE.prepare(
        "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
      )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 256 * 1024 * 1024 });
    expect(await resumeMediaCollection(test.context, job.id)).toMatchObject({
      terminalOutcome: "stored",
    });
    const detail = await getMediaJob(CONFIG, ALICE, job.id),
      asset = await ownedAsset(DATABASE, ALICE.id, detail.assets[0].id);
    expect(asset.id).toBe(receipt.id);
    expect(asset.validated_at).toBe(receipt.validatedAt);
    expect(asset.expires_at).toBe(receipt.validatedAt + 30 * 86400000);
    expect(
      test.transport.mock.calls.filter(([url]) =>
        String(url).endsWith("/video.mp4"),
      ),
    ).toHaveLength(1);
  });
  it("owner video GET/HEAD/Range remains private and concurrent deletion frees bytes only once", async () => {
    const test = await output(),
      id = test.detail.assets[0].id,
      path = `http://127.0.0.1:3000/api/media/assets/${id}/file`;
    await expect(assetFile(new Request(path), CONFIG, BOB, id)).rejects.toThrow(
      "not_found",
    );
    const response = await assetFile(
      new Request(path, { headers: { Range: "bytes=0-31" } }),
      CONFIG,
      ALICE,
      id,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(
      `bytes 0-31/${SYNTHETIC_MP4.length}`,
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      SYNTHETIC_MP4.slice(0, 32),
    );
    await Promise.all([
      deleteAsset(CONFIG, ALICE, id),
      deleteAsset(CONFIG, ALICE, id),
    ]);
    await expect(
      assetFile(new Request(path), CONFIG, ALICE, id),
    ).rejects.toThrow("not_found");
    expect(
      await DATABASE.prepare(
        "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
      )
        .bind(test.job.id)
        .first(),
    ).toEqual({ held_bytes: 0 });
    expect(
      await DATABASE.prepare(
        "SELECT quantity FROM media_usage_events WHERE job_id=?",
      )
        .bind(test.job.id)
        .first(),
    ).toEqual({ quantity: 5 });
  });
});
