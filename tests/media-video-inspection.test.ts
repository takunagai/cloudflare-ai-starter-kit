import { describe, expect, it } from "vitest";
import {
  inspectVideo,
  validateVideoRequest,
} from "../src/server/media/video-inspection";
import { SYNTHETIC_MP4, SYNTHETIC_MP4_AUDIO } from "./media-video-fixtures";
import { HIGH_PROFILE_VIDEOS } from "./media-video-high-fixtures";

const inspect = (bytes: Uint8Array<ArrayBuffer>) =>
  inspectVideo(
    async (offset, length) => bytes.slice(offset, offset + length),
    bytes.length,
  );
const position = (bytes: Uint8Array<ArrayBuffer>, type: string) =>
  new TextDecoder("latin1").decode(bytes).indexOf(type);
describe("M-3 MP4 container, H264 dimensions/sample tables/duration, bounded metadata", () => {
  it.each(HIGH_PROFILE_VIDEOS)(
    "inspects real 10s High profile with crop/B-frames $name",
    async (video) => {
      const configuration = position(video.bytes, "avcC");
      expect(configuration).toBeGreaterThan(0);
      expect(video.bytes[configuration + 5]).toBe(100);
      expect(position(video.bytes, "ctts")).toBeGreaterThan(0);
      const result = await inspect(video.bytes);
      expect(result).toEqual({
        format: "mp4",
        width: video.width,
        height: video.height,
        duration: 10,
        bytes: video.bytes.length,
      });
      expect(() =>
        validateVideoRequest(result, {
          duration: 10,
          resolution: video.resolution,
          aspectRatio: video.aspectRatio,
        }),
      ).not.toThrow();
      expect(() =>
        validateVideoRequest(result, {
          duration: 5,
          resolution: video.resolution,
          aspectRatio: video.aspectRatio,
        }),
      ).toThrow("media_video_invalid");
    },
  );
  it("accepts a real synthetic playable H264 file and inspects file-owned timing/dimensions", async () => {
    expect(await inspect(SYNTHETIC_MP4)).toEqual({
      format: "mp4",
      width: 480,
      height: 480,
      duration: 5,
      bytes: SYNTHETIC_MP4.length,
    });
  });
  it("accepts generated MP4 with an embedded synthetic AAC track and preserves video duration", async () => {
    expect(await inspect(SYNTHETIC_MP4_AUDIO)).toMatchObject({
      width: 480,
      height: 480,
      duration: 5,
      bytes: SYNTHETIC_MP4_AUDIO.length,
    });
  });
  it.each([
    "signature",
    "truncated",
    "overflow",
    "chunk-offset",
    "sample-count",
    "sample-duration",
    "codec",
    "width",
    "no-media",
    "external-reference",
    "rotation",
    "spoofed-dimensions",
  ])("rejects corrupt %s", async (kind) => {
    let bytes = SYNTHETIC_MP4.slice();
    const data = new DataView(bytes.buffer);
    if (kind === "signature") bytes[4] = 0;
    if (kind === "truncated") bytes = bytes.slice(0, -1);
    if (kind === "overflow") data.setUint32(0, 0xffffffff);
    if (kind === "chunk-offset")
      data.setUint32(position(bytes, "stco") + 12, 0xffffffff);
    if (kind === "sample-count")
      data.setUint32(position(bytes, "stsz") + 12, 0xffffffff);
    if (kind === "sample-duration")
      data.setUint32(position(bytes, "stts") + 16, 0);
    if (kind === "codec") bytes[position(bytes, "avcC") + 4] = 0;
    if (kind === "width") data.setUint32(position(bytes, "tkhd") + 80, 1);
    if (kind === "external-reference")
      data.setUint32(position(bytes, "url ") + 4, 0);
    if (kind === "rotation") data.setUint32(position(bytes, "tkhd") + 44, 0);
    if (kind === "spoofed-dimensions") {
      data.setUint16(position(bytes, "avcC") - 58, 640);
      data.setUint32(position(bytes, "tkhd") + 80, 640 * 65536);
    }
    if (kind === "no-media")
      bytes.set(new TextEncoder().encode("free"), position(bytes, "mdat"));
    await expect(inspect(bytes)).rejects.toThrow();
  });
  it.each([
    { duration: 4 },
    { duration: 5.8 },
    { width: 480, height: 768 },
    { width: 768, height: 768 },
  ])("rejects result/request mismatch %j", (change) => {
    expect(() =>
      validateVideoRequest(
        { width: 480, height: 480, duration: 5, ...change },
        { duration: 5, resolution: "480P", aspectRatio: "1:1" },
      ),
    ).toThrow("media_video_invalid");
  });
  it("allows documented0.7s overrun, with ordered source canvas and no silent conversion", () => {
    expect(() =>
      validateVideoRequest(
        { width: 480, height: 480, duration: 5.7 },
        { duration: 5, resolution: "480P" },
        { width: 1024, height: 1024 },
      ),
    ).not.toThrow();
    expect(() =>
      validateVideoRequest(
        { width: 480, height: 480, duration: 5 },
        { duration: 5, resolution: "480P" },
        { width: 1024, height: 512 },
      ),
    ).toThrow();
  });
  it("skips a256MiB free region without buffering video or an allocation proportional to its size", async () => {
    const total = 256 * 1024 * 1024,
      free = new Uint8Array(16);
    new DataView(free.buffer).setUint32(0, total - SYNTHETIC_MP4.length);
    free.set(new TextEncoder().encode("free"), 4);
    let largestRead = 0;
    const result = await inspectVideo(async (offset, length) => {
      largestRead = Math.max(largestRead, length);
      return offset < SYNTHETIC_MP4.length
        ? SYNTHETIC_MP4.slice(offset, offset + length)
        : free.slice(0, length);
    }, total);
    expect(result.bytes).toBe(total);
    expect(largestRead).toBeLessThan(8000);
  });
});
