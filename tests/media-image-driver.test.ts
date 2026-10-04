import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_ENDPOINTS } from "../src/lib/media-image-options";
import {
  assetMetadata,
  deleteAsset,
  ownedAsset,
} from "../src/server/media/assets";
import { normalizeMedia } from "../src/server/media/catalog";
import { handleMediaSource } from "../src/server/media/grants";
import {
  createImageDriver,
  imageAdapterReady,
  imageProviderInput,
} from "../src/server/media/image-driver";
import type { MediaEnv } from "../src/server/media/policy";
import {
  advanceMediaJob,
  getMediaJob,
  requestMediaCancellation,
  resumeMediaCollection,
  submitMedia,
} from "../src/server/media/service";
import {
  MEDIA_ALICE as alice,
  allowNextMediaPoll,
  MEDIA_DATABASE as database,
  MEDIA_ENV,
  mediaInput,
  resetMediaDatabase,
} from "./media-fixtures";
import { savedMediaImage, syntheticPng } from "./media-image-fixtures";

const CONFIG = {
  ...MEDIA_ENV,
  MEDIA_VERIFIED_IMAGE_MODELS: JSON.stringify(IMAGE_ENDPOINTS),
} as MediaEnv & { MEDIA_BUCKET: R2Bucket };
beforeEach(resetMediaDatabase);
async function fixture(
  options: {
    count?: number;
    url?: string;
    isRedirect?: boolean;
    hasWrongMime?: boolean;
    isPartial?: boolean;
    hasWrongDimensions?: boolean;
    isCorrupt?: boolean;
  } = {},
) {
  const bytes = await syntheticPng(1024, 1024),
    count = options.count ?? 1;
  let hasFailedSecond = false;
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    expect(init?.redirect).toBe("error");
    if (url.startsWith("https://queue.fal.run/")) {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Key ${CONFIG.FAL_KEY}`,
      );
      if (init?.method === "POST") {
        const submitted = JSON.parse(String(init.body)) as {
          image_urls?: string[];
          mask_url?: string;
        };
        for (const source of [
          ...(submitted.image_urls ?? []),
          ...(submitted.mask_url ? [submitted.mask_url] : []),
        ]) {
          const reference = await handleMediaSource(
            new Request(source),
            CONFIG,
          );
          expect(reference.headers.get("Content-Type")).toBe("image/png");
          expect((await reference.arrayBuffer()).byteLength).toBeGreaterThan(0);
        }
        return Response.json({
          request_id: "TEST_ONLY_image_request",
          response_url: "https://forged.example.invalid/",
          status_url: "https://forged.example.invalid/",
        });
      }
      if (url.endsWith("/status"))
        return Response.json({ status: "COMPLETED" });
      if (url.endsWith("/cancel"))
        return Response.json({ status: "CANCELLED" });
      return Response.json({
        images: Array.from({ length: count }, (_, ordinal) => ({
          url:
            options.url ??
            `https://v3b.fal.media/files/b/TEST_ONLY_store/image${ordinal}.png`,
          width: options.hasWrongDimensions ? 2048 : 1024,
          height: 1024,
          content_type: "image/png",
          file_size: bytes.length,
        })),
      });
    }
    if (url.startsWith("https://rest.fal.ai/storage/auth/token")) {
      expect(JSON.parse(String(init?.body))).toEqual({
        expiration_seconds: 300,
      });
      return Response.json({
        token: "TEST_ONLY_cdn_token",
        expires_at: new Date(Date.now() + 300000).toISOString(),
      });
    }
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer TEST_ONLY_cdn_token",
    );
    if (options.isPartial && !hasFailedSecond && url.endsWith("image1.png")) {
      hasFailedSecond = true;
      return new Response(null, { status: 503 });
    }
    if (options.isRedirect)
      return new Response(null, {
        status: 302,
        headers: { Location: "https://forged.example.invalid/" },
      });
    return new Response(
      options.isCorrupt ? new Uint8Array([137, 80, 78, 71]) : bytes,
      {
        headers: {
          "Content-Type": options.hasWrongMime ? "image/jpeg" : "image/png",
          "Content-Length": String(options.isCorrupt ? 4 : bytes.length),
        },
      },
    );
  });
  const driver = createImageDriver(CONFIG, transport),
    context = { env: CONFIG, identity: alice, driver };
  return { bytes, transport, driver, context };
}
describe("M-2 fixed image adapters with fake upstream and real workerd R2", () => {
  it.each([0, 1, 2, 3])(
    "submits image endpoint %s once, maps settings and privately stores/reuses actual decoded result",
    async (index) => {
      const { context, transport, bytes } = await fixture();
      const reference =
        index % 2 === 1
          ? await savedMediaImage(await syntheticPng(1024, 1024))
          : null;
      const raw = mediaInput(index, {
        prompt: "TEST_ONLY_image",
        size: { width: 1024, height: 1024 },
        quality: "xhigh",
        count: 1,
        format: "png",
        background: "opaque",
        ...(reference ? { references: [reference.id] } : {}),
      });
      const job = await submitMedia(context, raw);
      await submitMedia(context, raw);
      const submissions = transport.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith("https://queue.fal.run/") &&
          init?.method === "POST",
      );
      expect(submissions).toHaveLength(1);
      expect(submissions[0][0]).toBe(
        `https://queue.fal.run/${IMAGE_ENDPOINTS[index]}`,
      );
      const input = JSON.parse(String(submissions[0][1]?.body));
      expect(input).toMatchObject({
        prompt: "TEST_ONLY_image",
        image_size: { width: 1024, height: 1024 },
        quality: "xhigh",
        num_images: 1,
        output_format: "png",
        background: "opaque",
        sync_mode: false,
      });
      expect(
        new Headers(submissions[0][1]?.headers).get("X-Fal-No-Retry"),
      ).toBe("1");
      expect(
        new Headers(submissions[0][1]?.headers).get("X-Fal-Store-IO"),
      ).toBe("0");
      expect(
        JSON.parse(
          new Headers(submissions[0][1]?.headers).get(
            "X-Fal-Object-Lifecycle-Preference",
          ) ?? "{}",
        ),
      ).toEqual({
        expiration_duration_seconds: 3600,
        initial_acl: { default: "forbid", rules: [] },
      });
      if (reference) expect(input.image_urls).toHaveLength(1);
      await allowNextMediaPoll(job.id);
      expect(await advanceMediaJob(context, job.id)).toMatchObject({
        terminalOutcome: "stored",
        collectionState: "stored",
      });
      const detail = await getMediaJob(CONFIG, alice, job.id);
      expect(detail.assets).toHaveLength(1);
      const asset = await ownedAsset(database, alice.id, detail.assets[0].id);
      expect(asset.expires_at - asset.validated_at).toBe(30 * 86400000);
      expect(assetMetadata(asset).canReference).toBe(true);
      expect(
        await database
          .prepare(
            "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
          )
          .bind(job.id)
          .first(),
      ).toEqual({ held_bytes: bytes.length });
      const next = await submitMedia(
        context,
        mediaInput(1, { prompt: "TEST_ONLY_reuse", references: [asset.id] }),
      );
      expect(next.providerState).toBe("queued");
      expect((await ownedAsset(database, alice.id, asset.id)).expires_at).toBe(
        asset.expires_at,
      );
      expect(JSON.stringify(detail)).not.toMatch(
        /fal\.media|TEST_ONLY_cdn_token|TEST_ONLY_dummy_fal_key|token_hash|object_key/,
      );
    },
  );
  it("maps JPEG/WebP compression and preserves edit order/mask without extra provider fields", async () => {
    const first = crypto.randomUUID(),
      second = crypto.randomUUID(),
      mask = crypto.randomUUID();
    const media = normalizeMedia(
      mediaInput(3, {
        prompt: "TEST_ONLY_edit",
        format: "webp",
        compression: 0,
        references: [first, second],
        mask,
        size: "auto",
        background: "transparent",
      }),
    );
    expect(
      imageProviderInput(media, [
        {
          role: "reference",
          ordinal: 1,
          url: "https://example.invalid/second",
        },
        { role: "reference", ordinal: 0, url: "https://example.invalid/first" },
        { role: "mask", ordinal: 0, url: "https://example.invalid/mask" },
      ]),
    ).toEqual({
      prompt: "TEST_ONLY_edit",
      image_size: "auto",
      quality: "medium",
      num_images: 1,
      output_format: "webp",
      output_compression: 0,
      background: "transparent",
      sync_mode: false,
      image_urls: [
        "https://example.invalid/first",
        "https://example.invalid/second",
      ],
      mask_url: "https://example.invalid/mask",
    });
  });
  it("partial recovery retains max reservation, resumes same result and never overwrites first object/expiry", async () => {
    const { context, transport } = await fixture({ count: 2, isPartial: true });
    const job = await submitMedia(
      context,
      mediaInput(0, { prompt: "TEST_ONLY_partial", count: 2 }),
    );
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalAt: null,
      collectionState: "collection_failed",
    });
    const first = (await getMediaJob(CONFIG, alice, job.id)).assets[0];
    const row = await ownedAsset(database, alice.id, first.id);
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 40 * 1024 * 1024 });
    expect(await resumeMediaCollection(context, job.id)).toMatchObject({
      collectionState: "stored",
    });
    const current = await ownedAsset(database, alice.id, first.id);
    expect(current.validated_at).toBe(row.validated_at);
    expect(current.expires_at).toBe(row.expires_at);
    expect(
      transport.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith("https://queue.fal.run/") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      transport.mock.calls.filter(([url]) =>
        String(url).endsWith("image0.png"),
      ),
    ).toHaveLength(1);
  });
  it.each([
    "https://fal.media/files/output.png",
    "http://v3b.fal.media/files/b/store/image.png",
    "https://v3b.fal.media.evil.invalid/files/b/store/image.png",
    "https://v3b.fal.media/files/b/store/image.png?token=forged",
    "https://v3b.fal.media/files/b/store/%2e%2e",
    "data:image/png;base64,abc",
  ])(
    "rejects nonprivate output URL %s without CDN token/fallback",
    async (url) => {
      const { context, transport } = await fixture({ url });
      const job = await submitMedia(context, mediaInput());
      await allowNextMediaPoll(job.id);
      expect(await advanceMediaJob(context, job.id)).toMatchObject({
        terminalOutcome: "invalid",
      });
      expect(
        transport.mock.calls.every(([url]) =>
          String(url).startsWith("https://queue.fal.run/"),
        ),
      ).toBe(true);
    },
  );
  it.each([
    { hasWrongMime: true },
    { hasWrongDimensions: true },
    { isCorrupt: true },
  ])("does not succeed invalid output %j", async (options) => {
    const { context } = await fixture(options);
    const job = await submitMedia(context, mediaInput());
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "invalid",
    });
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 0 });
  });
  it("redirect failure holds job/storage and never sends credentials to redirect destination", async () => {
    const { context, transport } = await fixture({ isRedirect: true });
    const job = await submitMedia(context, mediaInput());
    await allowNextMediaPoll(job.id);
    await expect(advanceMediaJob(context, job.id)).rejects.toThrow(
      "media_collection_unavailable",
    );
    expect(
      transport.mock.calls.some(([url]) => String(url).includes("forged")),
    ).toBe(false);
    expect((await getMediaJob(CONFIG, alice, job.id)).terminalAt).toBeNull();
  });
  it("cancellation discards all private outputs and holds until deletion confirmation", async () => {
    const { context } = await fixture();
    const job = await submitMedia(context, mediaInput());
    await requestMediaCancellation(CONFIG, alice, job.id);
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "discarded",
    });
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 0 });
  });
  it("private output gate is per fixed endpoint and missing proof never falls back", async () => {
    expect(
      imageAdapterReady(
        { ...CONFIG, MEDIA_VERIFIED_IMAGE_MODELS: "[]" },
        IMAGE_ENDPOINTS[0],
      ),
    ).toBe(false);
    expect(
      imageAdapterReady(
        {
          ...CONFIG,
          MEDIA_VERIFIED_IMAGE_MODELS: JSON.stringify([IMAGE_ENDPOINTS[0]]),
        },
        IMAGE_ENDPOINTS[2],
      ),
    ).toBe(false);
    expect(
      imageAdapterReady(
        { ...CONFIG, MEDIA_VERIFIED_IMAGE_MODELS: "true" },
        IMAGE_ENDPOINTS[0],
      ),
    ).toBe(false);
    expect(imageAdapterReady(CONFIG, "minimax/h3-max/text-to-video")).toBe(
      false,
    );
  });
  it("rejects unverified upstream before quota reservation or dispatch", async () => {
    const unverified = { ...CONFIG, MEDIA_VERIFIED_IMAGE_MODELS: "[]" },
      network = vi.fn<typeof fetch>();
    await expect(
      submitMedia(
        {
          env: unverified,
          identity: alice,
          driver: createImageDriver(unverified, network),
        },
        mediaInput(),
      ),
    ).rejects.toThrow("media_upstream_unverified");
    expect(network).not.toHaveBeenCalled();
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 0 });
  });
  it("generated output deletion decrements actual bytes once while leaving consumed generation unchanged", async () => {
    const { context } = await fixture({ count: 2 });
    const job = await submitMedia(
      context,
      mediaInput(0, { prompt: "TEST_ONLY_delete", count: 2 }),
    );
    await allowNextMediaPoll(job.id);
    await advanceMediaJob(context, job.id);
    const assets = (await getMediaJob(CONFIG, alice, job.id)).assets;
    await Promise.all([
      deleteAsset(CONFIG, alice, assets[0].id),
      deleteAsset(CONFIG, alice, assets[0].id),
    ]);
    const remaining = await ownedAsset(database, alice.id, assets[1].id);
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: remaining.bytes });
    expect(
      await database
        .prepare("SELECT quantity FROM media_usage_events WHERE job_id=?")
        .bind(job.id)
        .first(),
    ).toEqual({ quantity: 2 });
  });
});
