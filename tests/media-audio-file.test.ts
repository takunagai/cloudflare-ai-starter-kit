import { beforeEach, describe, expect, it } from "vitest";
import { assetFile } from "../src/server/media/assets";
import { syntheticMp3, syntheticWav } from "./media-audio-fixtures";
import {
  MEDIA_ALICE as ALICE,
  MEDIA_BOB as BOB,
  MEDIA_DATABASE as DATABASE,
  MEDIA_ENV,
  resetMediaDatabase,
} from "./media-fixtures";

let AUDIO_BYTES = syntheticWav();
let format = "wav";

let assetId: string;
const BUCKET = MEDIA_ENV.MEDIA_BUCKET as R2Bucket;
describe.each(["wav", "mp3"])("M-4 owner audio Range %s", (audioFormat) => {
  beforeEach(async () => {
    format = audioFormat;
    AUDIO_BYTES = format === "wav" ? syntheticWav() : await syntheticMp3();
    await resetMediaDatabase();
    assetId = crypto.randomUUID();
    const now = Date.now();
    await BUCKET.put(`TEST_ONLY_range/${assetId}`, AUDIO_BYTES, {
      httpMetadata: {
        contentType: format === "wav" ? "audio/wav" : "audio/mpeg",
      },
    });
    await DATABASE.prepare(
      "INSERT INTO media_assets(id,owner_id,object_key,version,source,source_job_id,format,bytes,width,height,duration,state,validated_at,expires_at) VALUES(?,?,?,1,'result','TEST_ONLY_range_job',?,?,NULL,NULL,3,'ready',?,?)",
    )
      .bind(
        assetId,
        ALICE.id,
        `TEST_ONLY_range/${assetId}`,
        format,
        AUDIO_BYTES.length,
        now,
        now + 30 * 86400000,
      )
      .run();
  });
  const file = (
    headers: HeadersInit = {},
    method = "GET",
    config = MEDIA_ENV,
  ) =>
    assetFile(
      new Request(`http://127.0.0.1:3000/api/media/assets/${assetId}/file`, {
        method,
        headers,
      }),
      config,
      ALICE,
      assetId,
    );
  describe("M-4 authenticated single Range/If-Range/HEAD, private R2", () => {
    it.each([
      ["bytes=0-0", 0, 1],
      ["bytes=100-", 100, -1],
      ["bytes=-20", -20, 20],
      ["bytes=30-999999", 30, -1],
      ["bytes=-999999", 0, -1],
    ])(
      "supports %s with exact bounded bytes",
      async (range, rawStart, rawLength) => {
        const start = rawStart < 0 ? AUDIO_BYTES.length + rawStart : rawStart;
        const length = rawLength < 0 ? AUDIO_BYTES.length - start : rawLength;
        const response = await file({ Range: range });
        expect(response.status).toBe(206);
        expect(response.headers.get("Content-Length")).toBe(String(length));
        expect(response.headers.get("Content-Range")).toBe(
          `bytes ${start}-${start + length - 1}/${AUDIO_BYTES.length}`,
        );
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
          AUDIO_BYTES.slice(start, start + length),
        );
      },
    );
    it.each([
      "bytes=999999-",
      "bytes=10-9",
      "bytes=-0",
      "bytes=-",
      "bytes=0-2,4-5",
      "items=0-1",
      "bytes=1e2-",
      "bytes=0-NaN",
      "bytes=9007199254740992-",
    ])("returns owner-only416 for %s", async (range) => {
      const response = await file({ Range: range });
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe(
        `bytes */${AUDIO_BYTES.length}`,
      );
      expect(await response.text()).toBe("");
    });
    it("only strong ETag If-Range matches206; dates/mismatch/weak return whole200 per M-0", async () => {
      const head = await file({}, "HEAD"),
        etag = head.headers.get("ETag") ?? "",
        date = head.headers.get("Last-Modified") ?? "";
      for (const value of [etag]) {
        const response = await file({ Range: "bytes=0-31", "If-Range": value });
        expect(response.status).toBe(206);
        await response.body?.cancel();
      }
      for (const value of [
        '"TEST_ONLY_other"',
        date,
        `W/${etag}`,
        "yesterday",
        "Sun, 01 Jan 2023 00:00:00 GMT",
      ]) {
        const response = await file({ Range: "bytes=0-31", "If-Range": value });
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Range")).toBeNull();
        expect((await response.arrayBuffer()).byteLength).toBe(
          AUDIO_BYTES.length,
        );
      }
    });
    it("HEAD has no body, ignores Range and preserves full length/validator/private headers", async () => {
      const response = await file({ Range: "bytes=999999-" }, "HEAD");
      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
      expect(response.headers.get("Content-Length")).toBe(
        String(AUDIO_BYTES.length),
      );
      expect(response.headers.get("Accept-Ranges")).toBe("bytes");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });
    it("other-owner/expired/tombstoned metadata refuses before Range/ETag and R2 reads", async () => {
      await expect(
        assetFile(
          new Request("http://127.0.0.1:3000/", {
            headers: { Range: "bytes=999999-" },
          }),
          MEDIA_ENV,
          BOB,
          assetId,
        ),
      ).rejects.toThrow("not_found");
      await DATABASE.prepare("UPDATE media_assets SET expires_at=? WHERE id=?")
        .bind(Date.now(), assetId)
        .run();
      await expect(file({ Range: "bytes=0-1" })).rejects.toThrow("not_found");
      await DATABASE.prepare(
        "UPDATE media_assets SET expires_at=?,state='deleting' WHERE id=?",
      )
        .bind(Date.now() + 100000, assetId)
        .run();
      await expect(file()).rejects.toThrow("not_found");
    });
    it("deletion racing R2 get cancels returned body and refuses publication", async () => {
      const config = {
        ...MEDIA_ENV,
        MEDIA_BUCKET: {
          head: BUCKET.head.bind(BUCKET),
          async get(objectKey: string, options: R2GetOptions) {
            const object = await BUCKET.get(objectKey, options);
            await DATABASE.prepare(
              "UPDATE media_assets SET state='deleting' WHERE id=?",
            )
              .bind(assetId)
              .run();
            return object;
          },
        } as R2Bucket,
      };
      await expect(
        file({ Range: "bytes=0-31" }, "GET", config),
      ).rejects.toThrow("not_found");
    });
    it("client can cancel a Range body then seek with another request", async () => {
      const response = await file({ Range: "bytes=0-" });
      await response.body?.cancel();
      const seek = await file({ Range: "bytes=-100" });
      expect(seek.status).toBe(206);
      expect((await seek.arrayBuffer()).byteLength).toBe(100);
    });
  });
});
