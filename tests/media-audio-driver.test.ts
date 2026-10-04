import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIO_ENDPOINTS } from "../src/lib/media-audio-options";
import { assetFile, deleteAsset, ownedAsset } from "../src/server/media/assets";
import {
  audioAdapterReady,
  createAudioDriver,
} from "../src/server/media/audio-driver";
import { ownedMediaJob } from "../src/server/media/ledger";
import { handleMedia } from "../src/server/media/routes";
import {
  advanceMediaJob,
  getMediaJob,
  requestMediaCancellation,
  resumeMediaCollection,
  submitMedia,
} from "../src/server/media/service";
import { syntheticMp3, syntheticWav } from "./media-audio-fixtures";
import {
  MEDIA_ALICE as ALICE,
  allowNextMediaPoll,
  MEDIA_BOB as BOB,
  MEDIA_DATABASE as DATABASE,
  MEDIA_ENV,
  mediaInput,
  resetMediaDatabase,
} from "./media-fixtures";

const CONFIG = {
  ...MEDIA_ENV,
  MEDIA_VERIFIED_AUDIO_MODELS: JSON.stringify(AUDIO_ENDPOINTS),
};
beforeEach(resetMediaDatabase);
async function fixture(
  index = 8,
  options: {
    bytes?: Uint8Array<ArrayBuffer>;
    mime?: string;
    length?: string;
    url?: string;
    isWaiting?: boolean;
    isDisconnected?: boolean;
    isOverrun?: boolean;
    isUnderrun?: boolean;
    isLateCancel?: boolean;
    isRedirect?: boolean;
  } = {},
) {
  const bytes =
    options.bytes ??
    (index < 10
      ? syntheticWav()
      : await syntheticMp3(index === 10 ? 44100 : 48000));
  const mime = index < 10 ? "audio/wav" : "audio/mpeg";
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    expect(init?.redirect).toBe("error");
    if (url.startsWith("https://queue.fal.run/")) {
      if (init?.method === "POST")
        return Response.json({
          request_id: "TEST_ONLY_audio_request",
          response_url: "https://forged.example.invalid/",
        });
      if (url.endsWith("/cancel"))
        return Response.json({ status: "COMPLETED" });
      if (url.endsWith("/status"))
        return Response.json({
          status: options.isWaiting ? "IN_QUEUE" : "COMPLETED",
        });
      return Response.json({
        audio: {
          url: options.url ?? "https://v3b.fal.media/files/b/TEST_ONLY/audio",
          content_type: mime,
          file_size: bytes.length,
        },
      });
    }
    if (url.startsWith("https://rest.fal.ai/"))
      return Response.json({
        token: "TEST_ONLY_audio_cdn_token",
        expires_at: new Date(Date.now() + 300000).toISOString(),
      });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer TEST_ONLY_audio_cdn_token",
    );
    if (options.isRedirect) return new Response(null, { status: 302 });
    const streamed = options.isOverrun
      ? new Uint8Array([...bytes, 0])
      : options.isUnderrun
        ? bytes.slice(0, -1)
        : bytes;
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
          if (offset === streamed.length) {
            controller.close();
            return;
          }
          const end = Math.min(streamed.length, offset + 8191);
          controller.enqueue(streamed.slice(offset, end));
          offset = end;
        },
      }),
      {
        headers: {
          "Content-Type": options.mime ?? mime,
          "Content-Length": options.length ?? String(bytes.length),
        },
      },
    );
  });
  const driver = createAudioDriver(CONFIG, transport),
    context = { env: CONFIG, identity: ALICE, driver };
  const raw = mediaInput(
    index,
    index === 11 ? { prompt: "TEST_ONLY_music", duration: 3 } : undefined,
  );
  return { bytes, mime, transport, driver, context, raw };
}
async function output(index = 8, options: Parameters<typeof fixture>[1] = {}) {
  const test = await fixture(index, options),
    job = await submitMedia(test.context, test.raw);
  await allowNextMediaPoll(job.id);
  const result = await advanceMediaJob(test.context, job.id),
    detail = await getMediaJob(CONFIG, ALICE, job.id);
  return { ...test, job, result, detail };
}
describe("M-4 four fixed audio adapters; isolated workerd/D1/private R2, fake upstream", () => {
  it.each([8, 9, 10, 11])(
    "endpoint%s submits once, inspects/stores/reloads and accounts actual bytes",
    async (index) => {
      const test = await output(index);
      expect(test.result.terminalOutcome).toBe("stored");
      const asset = await ownedAsset(
        DATABASE,
        ALICE.id,
        test.detail.assets[0].id,
      );
      expect(asset.bytes).toBe(test.bytes.length);
      expect(asset.state).toBe("ready");
      expect(asset.duration).toBeGreaterThanOrEqual(3);
      expect(asset.expires_at - asset.validated_at).toBe(30 * 86400000);
      expect(JSON.stringify(test.detail)).not.toMatch(
        /fal\.media|cdn_token|object_key|token_hash/,
      );
      const object = await CONFIG.MEDIA_BUCKET?.get(asset.object_key);
      expect(object?.httpMetadata).toMatchObject({
        contentType: test.mime,
        cacheControl: "private, no-store",
      });
      if (!object) throw new Error("TEST_ONLY_object_missing");
      expect(new Uint8Array(await object.arrayBuffer())).toEqual(test.bytes);
      const post = test.transport.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith("https://queue.fal.run/") &&
          init?.method === "POST",
      );
      expect(post).toHaveLength(1);
      expect(post[0][0]).toBe(
        `https://queue.fal.run/${AUDIO_ENDPOINTS[index - 8]}`,
      );
      expect(new Headers(post[0][1]?.headers).get("X-Fal-No-Retry")).toBe("1");
      expect(new Headers(post[0][1]?.headers).get("X-Fal-Store-IO")).toBe("0");
      expect(
        new Headers(post[0][1]?.headers).get("x-app-fal-disable-fallback"),
      ).toBe("true");
      expect((await submitMedia(test.context, test.raw)).id).toBe(test.job.id);
      await expect(
        submitMedia(test.context, {
          ...test.raw,
          input: { ...test.raw.input, text: "different" },
        }),
      ).rejects.toThrow();
      const receipts = await test.driver.collect(
        await ownedMediaJob(DATABASE, ALICE.id, test.job.id),
        new AbortController().signal,
      );
      expect(receipts.assets[0]).toMatchObject({
        id: asset.id,
        validatedAt: asset.validated_at,
      });
      expect(
        test.transport.mock.calls.filter(([url]) =>
          String(url).endsWith("/audio"),
        ),
      ).toHaveLength(1);
      expect(
        await DATABASE.prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
          .bind(test.job.id)
          .first(),
      ).toEqual({ held_bytes: test.bytes.length });
      expect(
        await DATABASE.prepare(
          "SELECT quantity FROM media_usage_events WHERE job_id=?",
        )
          .bind(test.job.id)
          .first(),
      ).toEqual({
        quantity:
          index === 11
            ? 3
            : new TextEncoder().encode("TEST_ONLY_speech").length,
      });
    },
  );
  it.each([
    undefined,
    "[]",
    "true",
    JSON.stringify([AUDIO_ENDPOINTS[0], AUDIO_ENDPOINTS[0]]),
    JSON.stringify(["minimax/h3-max/text-to-video"]),
  ])(
    "rejects unverified/invalid gate %s before reservation/network",
    async (proof) => {
      const config = { ...CONFIG, MEDIA_VERIFIED_AUDIO_MODELS: proof },
        transport = vi.fn<typeof fetch>();
      expect(audioAdapterReady(config, AUDIO_ENDPOINTS[0])).toBe(false);
      await expect(
        submitMedia(
          {
            env: config,
            identity: ALICE,
            driver: createAudioDriver(config, transport),
          },
          mediaInput(8),
        ),
      ).rejects.toThrow("media_upstream_unverified");
      expect(transport).not.toHaveBeenCalled();
      expect(
        await DATABASE.prepare("SELECT count(*) AS n FROM media_jobs").first(),
      ).toEqual({ n: 0 });
    },
  );
  it("lists audio adapters as unverified with image/video gates kept separate", async () => {
    const response = await handleMedia(
      new Request("http://localhost/api/media/models"),
      MEDIA_ENV,
      ALICE,
    );
    if (!response) throw new Error("TEST_ONLY_response_missing");
    const body = (await response.json()) as {
      models: {
        id: string;
        hasAdapter: boolean;
        isExecutable: boolean;
        unavailableReason: string;
      }[];
    };
    for (const id of AUDIO_ENDPOINTS)
      expect(body.models.find((model) => model.id === id)).toMatchObject({
        hasAdapter: true,
        isExecutable: false,
        unavailableReason: "media_upstream_unverified",
      });
  });
  it.each([
    { mime: "image/png" },
    { length: "NaN" },
    { length: String(32 * 1024 * 1024 + 1) },
    { url: "https://fal.media/public.wav" },
    { url: "https://v3b.fal.media/files/b/TEST_ONLY/audio?token=forged" },
    { bytes: new Uint8Array(100) },
  ])(
    "rejects invalid audio%j and releases only after discard",
    async (options) => {
      const test = await output(8, options);
      expect(test.result.terminalOutcome).toBe("invalid");
      expect(test.detail.assets).toHaveLength(0);
      expect(
        await DATABASE.prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
          .bind(test.job.id)
          .first(),
      ).toEqual({ held_bytes: 0 });
    },
  );
  it.each([
    { isDisconnected: true },
    { isOverrun: true },
    { isUnderrun: true },
  ])(
    "unknown stream write%j retains full capacity and never regenerates on cancel/retry",
    async (options) => {
      const test = await fixture(8, options),
        job = await submitMedia(test.context, test.raw);
      await allowNextMediaPoll(job.id);
      await expect(advanceMediaJob(test.context, job.id)).rejects.toThrow(
        "media_audio_write_unknown",
      );
      await expect(
        resumeMediaCollection(test.context, job.id),
      ).rejects.toThrow();
      await requestMediaCancellation(CONFIG, ALICE, job.id);
      await allowNextMediaPoll(job.id);
      await expect(advanceMediaJob(test.context, job.id)).rejects.toThrow(
        "media_delete_pending",
      );
      expect(
        await DATABASE.prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
          .bind(job.id)
          .first(),
      ).toEqual({ held_bytes: 32 * 1024 * 1024 });
      expect((await getMediaJob(CONFIG, ALICE, job.id)).terminalAt).toBeNull();
      expect(
        test.transport.mock.calls.filter(
          ([url, init]) =>
            String(url).startsWith("https://queue.fal.run/") &&
            init?.method === "POST",
        ),
      ).toHaveLength(1);
    },
  );
  it("waiting/reload/second tab retain one provider request and cancellation intent", async () => {
    const test = await fixture(9, { isWaiting: true }),
      job = await submitMedia(test.context, test.raw);
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(test.context, job.id)).toMatchObject({
      providerState: "queued",
      terminalAt: null,
    });
    expect((await getMediaJob(CONFIG, ALICE, job.id)).input).toMatchObject({
      mode: "single",
      text: "TEST_ONLY_speech",
    });
    expect((await submitMedia(test.context, test.raw)).id).toBe(job.id);
    await expect(getMediaJob(CONFIG, BOB, job.id)).rejects.toThrow("not_found");
    await requestMediaCancellation(CONFIG, ALICE, job.id);
    expect(
      (await getMediaJob(CONFIG, ALICE, job.id)).isCancellationRequested,
    ).toBe(true);
  });
  it("late cancellation rejects publication then physically discards before freeing capacity", async () => {
    const test = await fixture(8, { isLateCancel: true }),
      job = await submitMedia(test.context, test.raw);
    await allowNextMediaPoll(job.id);
    await expect(advanceMediaJob(test.context, job.id)).rejects.toThrow(
      "media_collection_unavailable",
    );
    expect((await getMediaJob(CONFIG, ALICE, job.id)).assets).toHaveLength(0);
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(test.context, job.id)).toMatchObject({
      terminalOutcome: "discarded",
    });
    expect(
      await CONFIG.MEDIA_BUCKET?.head(`media/results/${job.id}/0`),
    ).toBeNull();
  });
  it("receipt ledger failure resumes the existing object, ID, first time and expiry with no new generation/CDN request", async () => {
    const test = await fixture(10);
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
    const job = await submitMedia(context, test.raw);
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
    if (!saved) throw new Error("TEST_ONLY_receipt_missing");
    const receipt = JSON.parse(saved.receipt_json);
    expect((await getMediaJob(CONFIG, ALICE, job.id)).assets).toHaveLength(0);
    expect(
      await DATABASE.prepare(
        "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
      )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 32 * 1024 * 1024 });
    expect(await resumeMediaCollection(test.context, job.id)).toMatchObject({
      terminalOutcome: "stored",
    });
    const detail = await getMediaJob(CONFIG, ALICE, job.id),
      asset = await ownedAsset(DATABASE, ALICE.id, detail.assets[0].id);
    expect(asset.id).toBe(receipt.id);
    expect(asset.expires_at).toBe(receipt.validatedAt + 30 * 86400000);
    expect(
      test.transport.mock.calls.filter(([url]) =>
        String(url).endsWith("/audio"),
      ),
    ).toHaveLength(1);
  });
  it("physical delete failure retains capacity; owner-only retry/concurrent delete release once with usage retained", async () => {
    const test = await output(11),
      id = test.detail.assets[0].id;
    await expect(deleteAsset(CONFIG, BOB, id)).rejects.toThrow("not_found");
    if (!CONFIG.MEDIA_BUCKET) throw new Error("TEST_ONLY_bucket_missing");
    const spy = vi
      .spyOn(CONFIG.MEDIA_BUCKET, "delete")
      .mockRejectedValueOnce(new Error("TEST_ONLY_delete_failure"));
    await expect(deleteAsset(CONFIG, ALICE, id)).rejects.toThrow();
    spy.mockRestore();
    expect(
      await DATABASE.prepare(
        "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
      )
        .bind(test.job.id)
        .first(),
    ).toEqual({ held_bytes: test.bytes.length });
    await Promise.all([
      deleteAsset(CONFIG, ALICE, id),
      deleteAsset(CONFIG, ALICE, id),
    ]);
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
    ).toEqual({ quantity: 3 });
    await expect(
      assetFile(new Request("http://localhost/"), CONFIG, ALICE, id),
    ).rejects.toThrow("not_found");
  });
});
