import { describe, expect, it } from "vitest";
import {
  boundedBytes,
  imageOperation,
  inspectImage,
} from "../src/server/media/image-inspection";
import {
  concatenate,
  pngChunk,
  SYNTHETIC_JPEG,
  SYNTHETIC_WEBP,
  syntheticPng,
} from "./media-image-fixtures";
import { LARGE_JPEG, LARGE_WEBP } from "./media-large-image-fixtures";

describe("M-2 workerd actual image decoding", () => {
  it.each([
    ["jpeg", LARGE_JPEG],
    ["webp", LARGE_WEBP],
  ] as const)(
    "decodes maximum-pixel %s within local workerd",
    async (format, bytes) => {
      expect(
        await imageOperation(() => inspectImage(bytes, `image/${format}`)),
      ).toMatchObject({ width: 4096, height: 2025 });
    },
  );
  it.each([
    ["jpeg", SYNTHETIC_JPEG],
    ["webp", SYNTHETIC_WEBP],
  ] as const)(
    "decodes synthetic %s with WASM in workerd",
    async (format, bytes) => {
      expect(await inspectImage(bytes, `image/${format}`)).toMatchObject({
        format,
        width: 16,
        height: 16,
        hasAlpha: false,
        bytes: bytes.length,
      });
      await expect(inspectImage(bytes, "image/png")).rejects.toThrow(
        "media_image_invalid",
      );
      await expect(
        inspectImage(bytes.subarray(0, bytes.length - 2), `image/${format}`),
      ).rejects.toThrow("media_image_invalid");
      await expect(
        inspectImage(
          concatenate([bytes, new Uint8Array([0])]),
          `image/${format}`,
        ),
      ).rejects.toThrow("media_image_invalid");
    },
  );
  it.each([false, true])(
    "inflates/unfilters PNG pixels and detects alpha=%s",
    async (hasAlpha) => {
      const bytes = await syntheticPng(1024, 1024, { hasAlpha });
      expect(await inspectImage(bytes, "image/png")).toMatchObject({
        width: 1024,
        height: 1024,
        hasAlpha,
      });
    },
  );
  it.each([{ isAnimated: true }, { filter: 5 }, { extraInflatedByte: true }])(
    "rejects animation/illegal filter/extra decoded bytes %j",
    async (options) => {
      await expect(
        inspectImage(await syntheticPng(16, 16, options), "image/png"),
      ).rejects.toThrow("media_image_invalid");
    },
  );
  it("rejects PNG truncation, CRC corruption, trailing data, MIME spoofing and invalid deflate despite a repaired CRC", async () => {
    const bytes = await syntheticPng(16, 16);
    const corrupted = bytes.slice();
    corrupted[45] ^= 255;
    const badDeflate = concatenate([
      bytes.subarray(0, 33),
      pngChunk("IDAT", new Uint8Array([120, 156, 0, 0, 0, 0])),
      pngChunk("IEND", new Uint8Array()),
    ]);
    for (const sample of [
      bytes.subarray(0, bytes.length - 1),
      corrupted,
      concatenate([bytes, new Uint8Array([1, 2])]),
      badDeflate,
      new TextEncoder().encode("<svg/>"),
      new Uint8Array([71, 73, 70]),
    ])
      await expect(inspectImage(sample, "image/png")).rejects.toThrow(
        "media_image_invalid",
      );
    await expect(inspectImage(bytes, "image/jpeg")).rejects.toThrow(
      "media_image_invalid",
    );
  });
  it("accepts the 8,294,400 pixel boundary in real workerd and rejects bigger header before decode", async () => {
    const bytes = await syntheticPng(4096, 2025);
    expect(await inspectImage(bytes, "image/png")).toMatchObject({
      width: 4096,
      height: 2025,
    });
    const header = bytes.slice(16, 29);
    new DataView(header.buffer).setUint32(4, 2026);
    await expect(
      inspectImage(
        concatenate([
          bytes.subarray(0, 8),
          pngChunk("IHDR", header),
          bytes.subarray(33),
        ]),
        "image/png",
      ),
    ).rejects.toThrow("media_image_invalid");
  });
  it("cancels oversized stream and admits only one memory operation per isolate", async () => {
    let isCancelled = false;
    await expect(
      boundedBytes(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(11));
          },
          cancel() {
            isCancelled = true;
          },
        }),
        10,
      ),
    ).rejects.toThrow("media_file_too_large");
    expect(isCancelled).toBe(true);
    await imageOperation(async () => {
      await expect(imageOperation(async () => 0)).rejects.toThrow(
        "media_image_inspector_busy",
      );
    });
    expect(await imageOperation(async () => 1)).toBe(1);
  });
  it("rejects corrupted JPEG/WebP compressed payload even when outer framing is valid", async () => {
    const jpeg = SYNTHETIC_JPEG.slice(),
      webp = SYNTHETIC_WEBP.slice();
    // JPEG: SOSまで保持し、空entropy＋EOI。WebP: RIFF/VP8 frame headerまで保持。
    const marker = jpeg.findIndex(
      (value, index) => value === 255 && jpeg[index + 1] === 218,
    );
    const segmentLength = (jpeg[marker + 2] << 8) + jpeg[marker + 3];
    await expect(
      inspectImage(
        concatenate([
          jpeg.subarray(0, marker + 2 + segmentLength),
          new Uint8Array([255, 217]),
        ]),
        "image/jpeg",
      ),
    ).rejects.toThrow("media_image_invalid");
    const truncatedWebp = webp.slice(0, 30);
    new DataView(truncatedWebp.buffer).setUint32(
      4,
      truncatedWebp.length - 8,
      true,
    );
    new DataView(truncatedWebp.buffer).setUint32(16, 10, true);
    await expect(inspectImage(truncatedWebp, "image/webp")).rejects.toThrow(
      "media_image_invalid",
    );
  });
});
