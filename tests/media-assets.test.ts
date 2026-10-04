import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetFile,
  deleteAsset,
  maintainMediaAssets,
  ownedAsset,
  reserveUpload,
  uploadAsset,
} from "../src/server/media/assets";
import type { MediaEnv } from "../src/server/media/policy";
import {
  readMediaRecoveryWitness,
  reconcileMediaRecovery,
} from "../src/server/media/retention";
import {
  MEDIA_ALICE as alice,
  MEDIA_BOB as bob,
  MEDIA_DATABASE as database,
  MEDIA_ENV,
  resetMediaDatabase,
} from "./media-fixtures";
import {
  SYNTHETIC_JPEG,
  SYNTHETIC_WEBP,
  syntheticPng,
} from "./media-image-fixtures";

const ASSET_ENV = MEDIA_ENV as MediaEnv & { MEDIA_BUCKET: R2Bucket };
async function savedImage(
  bytes: Uint8Array<ArrayBuffer>,
  mime = "image/png",
  identity = alice,
  config = ASSET_ENV,
) {
  const reservation = await reserveUpload(config, identity, {
    bytes: bytes.length,
    contentType: mime,
  });
  return uploadAsset(
    new Request(`http://127.0.0.1:3000${reservation.uploadPath}`, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: bytes,
    }),
    config,
    identity,
    reservation.id,
  );
}
beforeEach(resetMediaDatabase);
describe("M-2 isolated D1/R2 upload and physical deletion", () => {
  it.each([
    ["image/jpeg", SYNTHETIC_JPEG],
    ["image/webp", SYNTHETIC_WEBP],
  ] as const)("stores decoded %s privately", async (mime, bytes) => {
    const asset = await savedImage(bytes, mime);
    expect(asset).toMatchObject({
      state: "ready",
      bytes: bytes.length,
      width: 16,
      height: 16,
      canReference: true,
    });
    const row = await ownedAsset(database, alice.id, asset.id);
    expect(row.expires_at - row.validated_at).toBe(7 * 86400000);
    const file = await assetFile(
      new Request("http://127.0.0.1:3000/"),
      ASSET_ENV,
      alice,
      asset.id,
    );
    expect(file.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(JSON.stringify(asset)).not.toMatch(
      /object_key|media\/uploads|token/,
    );
  });
  it("keeps reservation private until real file validation; single-use upload does not extend expiry", async () => {
    const bytes = await syntheticPng(32, 32, { hasAlpha: true }),
      reservation = await reserveUpload(ASSET_ENV, alice, {
        bytes: bytes.length,
        contentType: "image/png",
      });
    await expect(
      assetFile(
        new Request("http://127.0.0.1:3000/"),
        ASSET_ENV,
        alice,
        reservation.id,
      ),
    ).rejects.toThrow("not_found");
    const file = () =>
      new Request(`http://127.0.0.1:3000${reservation.uploadPath}`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: bytes,
      });
    await expect(
      uploadAsset(file(), ASSET_ENV, bob, reservation.id),
    ).rejects.toThrow("not_found");
    const asset = await uploadAsset(file(), ASSET_ENV, alice, reservation.id);
    await expect(
      uploadAsset(file(), ASSET_ENV, alice, reservation.id),
    ).rejects.toThrow("media_upload_unavailable");
    expect((await ownedAsset(database, alice.id, asset.id)).expires_at).toBe(
      asset.expiresAt,
    );
    await expect(deleteAsset(ASSET_ENV, bob, asset.id)).rejects.toThrow(
      "not_found",
    );
  });
  it("atomically accepts two pending uploads and rejects third/parallel capacity overflow", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        reserveUpload(ASSET_ENV, alice, {
          bytes: 1024,
          contentType: "image/png",
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(
      await database
        .prepare(
          "SELECT sum(held_bytes) AS n FROM media_storage_holds WHERE owner_id=?",
        )
        .bind(alice.id)
        .first(),
    ).toEqual({ n: 2048 });
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_assets").first(),
    ).toEqual({ n: 2 });
  });
  it.each(["owner", "environment"])(
    "checks %s capacity using upload+M-1 holds and rolls back asset INSERT",
    async (scope) => {
      await database
        .prepare(
          "INSERT INTO media_storage_reservations VALUES('TEST_ONLY_storage',?,?,'stored')",
        )
        .bind(
          scope === "owner" ? alice.id : bob.id,
          scope === "owner" ? 1073741824 : 10737418240,
        )
        .run();
      await expect(
        reserveUpload(ASSET_ENV, alice, { bytes: 1, contentType: "image/png" }),
      ).rejects.toThrow("media_limit_reached");
      expect(
        await database
          .prepare("SELECT count(*) AS n FROM media_assets")
          .first(),
      ).toEqual({ n: 0 });
    },
  );
  it("rejects size/MIME/animation/corruption and never exposes invalid object", async () => {
    const bytes = await syntheticPng(16, 16, { isAnimated: true });
    await expect(savedImage(bytes)).rejects.toThrow("media_image_invalid");
    expect(
      await database.prepare("SELECT state FROM media_assets").first(),
    ).toEqual({ state: "deleted" });
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: null });
    for (const raw of [
      { bytes: 0, contentType: "image/png" },
      { bytes: 10485761, contentType: "image/png" },
      { bytes: 10, contentType: "image/svg+xml" },
      { bytes: 10, contentType: "image/png", objectKey: "forged" },
    ])
      await expect(reserveUpload(ASSET_ENV, alice, raw)).rejects.toThrow(
        "invalid_input",
      );
  });
  it("rejects Content-Length/MIME lies before claim and keeps reservation for deletion", async () => {
    const reservation = await reserveUpload(ASSET_ENV, alice, {
      bytes: 4,
      contentType: "image/png",
    });
    for (const headers of [
      { "Content-Type": "image/webp" },
      { "Content-Type": "image/png", "Content-Length": "3" },
      { "Content-Type": "image/png", "Content-Encoding": "gzip" },
    ] as HeadersInit[])
      await expect(
        uploadAsset(
          new Request("http://127.0.0.1:3000/", {
            method: "PUT",
            headers,
            body: new Uint8Array(4),
          }),
          ASSET_ENV,
          alice,
          reservation.id,
        ),
      ).rejects.toThrow();
    expect(
      await database.prepare("SELECT state FROM media_uploads").first(),
    ).toEqual({ state: "reserved" });
    await deleteAsset(ASSET_ENV, alice, reservation.id);
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: null });
  });
  it("bounds unknown-length upload streams and retains an uncertain write instead of releasing quota", async () => {
    const reservation = await reserveUpload(ASSET_ENV, alice, {
      bytes: 4,
      contentType: "image/png",
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    });
    await expect(
      uploadAsset(
        new Request("http://127.0.0.1:3000/", {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: stream,
        }),
        ASSET_ENV,
        alice,
        reservation.id,
      ),
    ).rejects.toThrow();
    expect(
      await database.prepare("SELECT state FROM media_uploads").first(),
    ).toEqual({ state: "write_unknown" });
    await expect(deleteAsset(ASSET_ENV, alice, reservation.id)).rejects.toThrow(
      "media_delete_pending",
    );
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: 4 });
  });
  it("expiry rejects reads before maintenance and deletes expired ready/reserved objects boundedly", async () => {
    const asset = await savedImage(await syntheticPng(16, 16));
    const row = await ownedAsset(database, alice.id, asset.id);
    await database
      .prepare("UPDATE media_assets SET validated_at=0,expires_at=? WHERE id=?")
      .bind(Date.now(), asset.id)
      .run();
    await expect(
      assetFile(
        new Request("http://127.0.0.1:3000/"),
        ASSET_ENV,
        alice,
        asset.id,
      ),
    ).rejects.toThrow("not_found");
    await maintainMediaAssets(ASSET_ENV);
    expect(await ASSET_ENV.MEDIA_BUCKET.head(row.object_key)).toBeNull();
    const reservation = await reserveUpload(ASSET_ENV, alice, {
      bytes: 4,
      contentType: "image/png",
    });
    await database
      .prepare("UPDATE media_assets SET validated_at=0,expires_at=1 WHERE id=?")
      .bind(reservation.id)
      .run();
    await database
      .prepare("UPDATE media_uploads SET expires_at=1 WHERE asset_id=?")
      .bind(reservation.id)
      .run();
    await maintainMediaAssets(ASSET_ENV);
    expect((await ownedAsset(database, alice.id, reservation.id)).state).toBe(
      "deleted",
    );
  });
  it("deletion failure keeps tombstone/capacity; retry confirms physical R2 removal once", async () => {
    const asset = await savedImage(await syntheticPng(16, 16)),
      row = await ownedAsset(database, alice.id, asset.id);
    const failing = {
      ...ASSET_ENV,
      MEDIA_BUCKET: new Proxy(ASSET_ENV.MEDIA_BUCKET, {
        get(target, property) {
          if (property === "delete")
            return vi.fn(async () => {
              throw new Error("TEST_ONLY_delete_failure");
            });
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    await expect(deleteAsset(failing, alice, asset.id)).rejects.toThrow(
      "media_delete_pending",
    );
    expect((await ownedAsset(database, alice.id, asset.id)).state).toBe(
      "deleting",
    );
    expect(await ASSET_ENV.MEDIA_BUCKET.head(row.object_key)).not.toBeNull();
    await expect(
      assetFile(
        new Request("http://127.0.0.1:3000/"),
        ASSET_ENV,
        alice,
        asset.id,
      ),
    ).rejects.toThrow("not_found");
    await Promise.all([
      deleteAsset(ASSET_ENV, alice, asset.id),
      deleteAsset(ASSET_ENV, alice, asset.id),
    ]);
    expect(await ASSET_ENV.MEDIA_BUCKET.head(row.object_key)).toBeNull();
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: null });
  });
  it("tombstones during live writer without physical deletion or capacity release, and writer later discards", async () => {
    const reservation = await reserveUpload(ASSET_ENV, alice, {
      bytes: 4,
      contentType: "image/png",
    });
    await database
      .prepare("UPDATE media_uploads SET state='writing' WHERE asset_id=?")
      .bind(reservation.id)
      .run();
    await expect(deleteAsset(ASSET_ENV, alice, reservation.id)).rejects.toThrow(
      "media_delete_pending",
    );
    expect((await ownedAsset(database, alice.id, reservation.id)).state).toBe(
      "deleting",
    );
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: 4 });
  });
  it("OFF allows owner read/delete but prevents new uploads; recovery/RAG bucket alias fail closed", async () => {
    const asset = await savedImage(await syntheticPng(16, 16));
    const off = {
      ...ASSET_ENV,
      ENABLE_MEDIA: "false",
      MEDIA_ALLOWED_MODELS: "[]",
      FAL_KEY: undefined,
    };
    const response = await assetFile(
      new Request("http://127.0.0.1:3000/"),
      off,
      alice,
      asset.id,
    );
    await response.body?.cancel();
    await expect(
      reserveUpload(off, alice, { bytes: 1, contentType: "image/png" }),
    ).rejects.toThrow("media_disabled");
    await deleteAsset(off, alice, asset.id);
    await expect(
      reserveUpload({ ...ASSET_ENV, MEDIA_BUCKET: undefined }, alice, {
        bytes: 1,
        contentType: "image/png",
      }),
    ).rejects.toThrow("media_storage_not_configured");
    await expect(
      reserveUpload(
        { ...ASSET_ENV, MEDIA_BUCKET: ASSET_ENV.RAG_BUCKET },
        alice,
        { bytes: 1, contentType: "image/png" },
      ),
    ).rejects.toThrow("media_storage_not_configured");
    await database
      .prepare("UPDATE media_runtime_state SET is_recovery_blocked=1")
      .run();
    await expect(
      reserveUpload(ASSET_ENV, alice, { bytes: 1, contentType: "image/png" }),
    ).rejects.toThrow("media_recovery_blocked");
  });
  it("restore witness includes upload writes and gate stays closed for unconfirmed object writes", async () => {
    const reservation = await reserveUpload(ASSET_ENV, alice, {
      bytes: 4,
      contentType: "image/png",
    });
    await database
      .prepare(
        "UPDATE media_uploads SET state='write_unknown' WHERE asset_id=?",
      )
      .bind(reservation.id)
      .run();
    const witness = await readMediaRecoveryWitness(database);
    expect(witness.uploads).toHaveLength(1);
    await expect(
      reconcileMediaRecovery(database, witness, async () => true),
    ).rejects.toThrow("media_recovery_unresolved_assets");
    expect(
      await database
        .prepare(
          "SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1",
        )
        .first(),
    ).toEqual({ is_recovery_blocked: 1 });
  });
});
