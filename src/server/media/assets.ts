import { z } from "zod";
import { checkExtensionRuntimePolicy } from "../ai-verification";
import type { Identity } from "../env";
import { ApiError, json, readJson } from "../http";
import { MEDIA_LIMITS } from "./catalog";
import {
  boundedBytes,
  IMAGE_MIMES,
  imageOperation,
  inspectImage,
} from "./image-inspection";
import {
  type MediaAsset,
  mediaDatabase,
  requireMediaRecoveryReady,
} from "./ledger";
import {
  type MediaEnv,
  requireMediaBucket,
  requireMediaEnabled,
} from "./policy";
import { confirmMediaAssetDeletion } from "./retention";

export const UPLOAD_LIMIT = 10 * 1024 * 1024;
export const UPLOAD_LEASE_MS = 10 * 60_000;
export const uploadSchema = z.strictObject({
  bytes: z.number().int().positive().max(UPLOAD_LIMIT),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});
interface Upload {
  asset_id: string;
  owner_id: string;
  declared_bytes: number;
  content_type: string;
  state: "reserved" | "writing" | "write_unknown" | "settled";
  expires_at: number;
}
export async function ownedAsset(
  database: D1Database,
  owner: string,
  id: string,
) {
  const asset = await mediaDatabase(
    database
      .prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?")
      .bind(id, owner)
      .first<MediaAsset>(),
  );
  if (!asset) throw new ApiError(404, "not_found");
  return asset;
}
export function assetMetadata(asset: MediaAsset, now = Date.now()) {
  const isAvailable = asset.state === "ready" && asset.expires_at > now;
  const canReference =
    isAvailable &&
    ["png", "jpeg", "webp"].includes(asset.format) &&
    asset.bytes <= UPLOAD_LIMIT &&
    !!asset.width &&
    !!asset.height &&
    Math.max(asset.width, asset.height) <= 4096 &&
    asset.width * asset.height <= 8_294_400;
  return {
    id: asset.id,
    version: asset.version,
    source: asset.source,
    format: asset.format,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    hasAlpha: asset.has_alpha === 1,
    state: asset.state,
    expiresAt: asset.expires_at,
    isAvailable,
    canReference,
    referenceUnavailableReason: canReference
      ? null
      : !isAvailable
        ? "media_asset_unavailable"
        : "media_reference_limit",
  };
}
export async function reserveUpload(
  env: MediaEnv,
  identity: Identity,
  raw: unknown,
) {
  requireMediaEnabled(env);
  requireMediaBucket(env);
  await requireMediaRecoveryReady(env.DB);
  const input = uploadSchema.safeParse(raw);
  if (!input.success) throw new ApiError(400, "invalid_input");
  await checkExtensionRuntimePolicy(env);
  await maintainMediaAssets(env);
  const id = crypto.randomUUID(),
    now = Date.now(),
    expiresAt = now + UPLOAD_LEASE_MS;
  const format = input.data.contentType.slice(6);
  await mediaDatabase(
    env.DB.batch([
      env.DB.prepare(
        "INSERT INTO media_assets(id,owner_id,object_key,version,source,format,bytes,state,validated_at,expires_at) VALUES(?,?,?,1,'upload',?,?,'quarantined',?,?)",
      ).bind(
        id,
        identity.id,
        `media/uploads/${id}`,
        format,
        input.data.bytes,
        now,
        expiresAt,
      ),
      env.DB.prepare(
        "INSERT INTO media_uploads VALUES(?,?,?,?,'reserved',?)",
      ).bind(
        id,
        identity.id,
        input.data.bytes,
        input.data.contentType,
        expiresAt,
      ),
    ]),
  );
  return { id, expiresAt, uploadPath: `/api/media/assets/${id}/file` };
}
async function streamUpload(
  bucket: R2Bucket,
  asset: MediaAsset,
  upload: Upload,
  request: Request,
) {
  const source = request.body?.getReader();
  if (!source) throw new ApiError(400, "media_file_empty");
  const fixed = new FixedLengthStream(upload.declared_bytes),
    writer = fixed.writable.getWriter();
  const stored = bucket.put(asset.object_key, fixed.readable, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType: upload.content_type,
      cacheControl: "private, no-store",
    },
  });
  const pumping = (async () => {
    let bytes = 0;
    try {
      for (;;) {
        const part = await source.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > upload.declared_bytes)
          throw new ApiError(413, "media_file_too_large");
        await writer.write(part.value);
      }
      if (bytes !== upload.declared_bytes)
        throw new ApiError(400, "media_file_size_mismatch");
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      await source.cancel().catch(() => {});
      throw error;
    } finally {
      source.releaseLock();
      writer.releaseLock();
    }
  })();
  // R2側が先に失敗した場合もproducerを停止し、未完の書込みを削除確認へ渡さない。
  const writing = stored.catch(async () => {
    await source.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    throw new ApiError(502, "media_upload_write_unknown");
  });
  const results = await Promise.allSettled([writing, pumping]);
  if (results[0].status !== "fulfilled" || !results[0].value)
    throw new ApiError(502, "media_upload_write_unknown");
  if (results[1].status === "rejected") throw results[1].reason;
  return results[0].value;
}
export async function uploadAsset(
  request: Request,
  env: MediaEnv,
  identity: Identity,
  id: string,
) {
  requireMediaEnabled(env);
  const bucket = requireMediaBucket(env);
  await requireMediaRecoveryReady(env.DB);
  const asset = await ownedAsset(env.DB, identity.id, id);
  const upload = await mediaDatabase(
    env.DB.prepare(
      "SELECT * FROM media_uploads WHERE asset_id=? AND owner_id=?",
    )
      .bind(id, identity.id)
      .first<Upload>(),
  );
  if (
    !upload ||
    asset.state !== "quarantined" ||
    upload.state !== "reserved" ||
    upload.expires_at <= Date.now()
  )
    throw new ApiError(409, "media_upload_unavailable");
  if (
    request.headers.get("Content-Type") !== upload.content_type ||
    (request.headers.has("Content-Encoding") &&
      request.headers.get("Content-Encoding") !== "identity")
  )
    throw new ApiError(415, "unsupported_media_type");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && declared !== String(upload.declared_bytes))
    throw new ApiError(400, "media_file_size_mismatch");
  return imageOperation(async () => {
    await checkExtensionRuntimePolicy(env);
    const claim = await mediaDatabase(
      env.DB.prepare(
        "UPDATE media_uploads SET state='writing' WHERE asset_id=? AND owner_id=? AND state='reserved' AND expires_at>? AND EXISTS(SELECT 1 FROM media_assets WHERE id=? AND state='quarantined') AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0",
      )
        .bind(id, identity.id, Date.now(), id)
        .run(),
    );
    if (claim.meta.changes !== 1)
      throw new ApiError(409, "media_upload_unavailable");
    let hasConfirmedWrite = false;
    try {
      await streamUpload(bucket, asset, upload, request);
      hasConfirmedWrite = true;
      const object = await bucket.get(asset.object_key);
      if (!object || object.size !== upload.declared_bytes)
        throw new ApiError(502, "media_storage_unavailable");
      const image = await inspectImage(
        await boundedBytes(object.body, UPLOAD_LIMIT),
        upload.content_type,
      );
      const now = Date.now();
      const result = await mediaDatabase(
        env.DB.batch([
          env.DB.prepare(
            "UPDATE media_assets SET format=?,bytes=?,width=?,height=?,has_alpha=?,state='ready',validated_at=?,expires_at=? WHERE id=? AND owner_id=? AND state='quarantined' AND EXISTS(SELECT 1 FROM media_uploads WHERE asset_id=? AND state='writing' AND expires_at>?) AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0",
          ).bind(
            image.format,
            image.bytes,
            image.width,
            image.height,
            image.hasAlpha ? 1 : 0,
            now,
            now + MEDIA_LIMITS.referenceLifetimeMs,
            id,
            identity.id,
            id,
            now,
          ),
          env.DB.prepare(
            "UPDATE media_uploads SET state='settled' WHERE asset_id=? AND owner_id=?",
          ).bind(id, identity.id),
        ]),
      );
      if (result[0].meta.changes !== 1)
        throw new ApiError(409, "media_upload_unavailable");
      return assetMetadata(await ownedAsset(env.DB, identity.id, id));
    } catch (error) {
      await mediaDatabase(
        env.DB.batch([
          env.DB.prepare(
            "UPDATE media_uploads SET state=? WHERE asset_id=? AND owner_id=?",
          ).bind(
            hasConfirmedWrite ? "settled" : "write_unknown",
            id,
            identity.id,
          ),
          env.DB.prepare(
            "UPDATE media_assets SET state='deleting' WHERE id=? AND owner_id=? AND state!='deleted'",
          ).bind(id, identity.id),
        ]),
      );
      if (hasConfirmedWrite)
        await deleteAsset(env, identity, id).catch(() => {});
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "media_upload_unavailable");
    }
  });
}
export async function deleteAsset(
  env: MediaEnv,
  identity: Identity,
  id: string,
) {
  const bucket = requireMediaBucket(env);
  await requireMediaRecoveryReady(env.DB);
  return confirmMediaAssetDeletion(env.DB, identity.id, id, async (asset) => {
    const pending = await mediaDatabase(
      env.DB.prepare(
        "SELECT state FROM media_uploads WHERE asset_id=? UNION ALL SELECT state FROM media_output_objects WHERE asset_id=?",
      )
        .bind(id, id)
        .all<{ state: string }>(),
    );
    if (
      pending.results.some(
        (row) => row.state === "writing" || row.state === "write_unknown",
      )
    )
      return false;
    // 予約だけならPUTをclaimできなくしてから削除する。
    await mediaDatabase(
      env.DB.prepare(
        "UPDATE media_uploads SET state='settled' WHERE asset_id=? AND state='reserved'",
      )
        .bind(id)
        .run(),
    );
    try {
      await bucket.delete(asset.object_key);
      if (await bucket.head(asset.object_key)) return false;
    } catch {
      return false;
    }
    await mediaDatabase(
      env.DB.prepare(
        "UPDATE media_output_objects SET state='deleted' WHERE asset_id=? AND state!='writing' AND state!='write_unknown'",
      )
        .bind(id)
        .run(),
    );
    return true;
  });
}
export async function maintainMediaAssets(env: MediaEnv, now = Date.now()) {
  await requireMediaRecoveryReady(env.DB);
  requireMediaBucket(env);
  const rows = await mediaDatabase(
    env.DB.prepare(
      "SELECT id,owner_id FROM media_assets WHERE state='deleting' OR (state!='deleted' AND expires_at<=?) ORDER BY expires_at LIMIT 20",
    )
      .bind(now)
      .all<{ id: string; owner_id: string }>(),
  );
  for (const row of rows.results)
    await deleteAsset(
      env,
      { id: row.owner_id, email: "", name: "" },
      row.id,
    ).catch(() => {});
}
export async function assetFile(
  request: Request,
  env: MediaEnv,
  identity: Identity,
  id: string,
) {
  const asset = await ownedAsset(env.DB, identity.id, id);
  if (asset.state !== "ready" || asset.expires_at <= Date.now())
    throw new ApiError(404, "not_found");
  if (!["png", "jpeg", "webp"].includes(asset.format))
    throw new ApiError(415, "unsupported_media_type");
  if (request.headers.has("Range"))
    throw new ApiError(416, "media_range_unsupported");
  const bucket = requireMediaBucket(env);
  const object =
    request.method === "HEAD"
      ? await bucket.head(asset.object_key)
      : await bucket.get(asset.object_key);
  const current = await ownedAsset(env.DB, identity.id, id);
  if (
    !object ||
    object.size !== asset.bytes ||
    current.state !== "ready" ||
    current.expires_at <= Date.now()
  ) {
    if (object && "body" in object)
      await (object as R2ObjectBody).body.cancel().catch(() => {});
    throw new ApiError(404, "not_found");
  }
  return new Response("body" in object ? (object as R2ObjectBody).body : null, {
    headers: {
      "Content-Type": IMAGE_MIMES[asset.format as keyof typeof IMAGE_MIMES],
      "Content-Length": String(asset.bytes),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Disposition": "inline",
    },
  });
}
export async function handleAssets(
  request: Request,
  env: MediaEnv,
  identity: Identity,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const response = (body: unknown, status = 200) =>
    json(body, status, { "Cache-Control": "private, no-store" });
  if (path === "/api/media/assets") {
    if (request.method === "POST")
      return response(
        await reserveUpload(
          env,
          identity,
          await readJson(request, uploadSchema, 1024, true),
        ),
        201,
      );
    if (request.method !== "GET") throw new ApiError(405, "method_not_allowed");
    if (env.MEDIA_BUCKET) await maintainMediaAssets(env).catch(() => {});
    const assets = await mediaDatabase(
      env.DB.prepare(
        "SELECT * FROM media_assets WHERE owner_id=? AND state!='deleted' ORDER BY validated_at DESC LIMIT 100",
      )
        .bind(identity.id)
        .all<MediaAsset>(),
    );
    return response({
      assets: assets.results.map((asset) => assetMetadata(asset)),
    });
  }
  const match = /^\/api\/media\/assets\/([a-f0-9-]{36})(?:\/(file))?$/.exec(
    path,
  );
  if (!match) return null;
  if (!z.uuid().safeParse(match[1]).success)
    throw new ApiError(400, "invalid_input");
  if (match[2]) {
    if (request.method === "PUT")
      return response(await uploadAsset(request, env, identity, match[1]));
    if (["GET", "HEAD"].includes(request.method))
      return assetFile(request, env, identity, match[1]);
  } else {
    if (request.method === "GET")
      return response(
        assetMetadata(await ownedAsset(env.DB, identity.id, match[1])),
      );
    if (request.method === "DELETE")
      return response(await deleteAsset(env, identity, match[1]));
  }
  throw new ApiError(405, "method_not_allowed");
}
