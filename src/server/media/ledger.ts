import { ApiError } from "../http";
import { MEDIA_LIMITS, type MediaKind, type NormalizedMedia } from "./catalog";

export interface MediaJob {
  id: string;
  owner_id: string;
  request_key: string;
  request_uuid: string;
  input_hash: string;
  model_id: string;
  catalog_version: string;
  kind: MediaKind;
  quantity: number;
  reserved_bytes: number;
  provider_id: string | null;
  provider_state:
    | "reserved"
    | "submitting"
    | "submission_unknown"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  collection_state:
    | "pending"
    | "collecting"
    | "collection_failed"
    | "stored"
    | "invalid"
    | "deleting"
    | "discarded";
  attempt_count: number;
  collection_attempts: number;
  next_poll_at: number;
  monitor_until: number;
  lease_token: string | null;
  lease_until: number | null;
  cancel_requested_at: number | null;
  cancel_sent_at: number | null;
  body_erased_at: number | null;
  created_at: number;
  updated_at: number;
  terminal_at: number | null;
  terminal_outcome:
    | "stored"
    | "failed"
    | "invalid"
    | "cancelled"
    | "discarded"
    | null;
}
export interface MediaAsset {
  id: string;
  owner_id: string;
  object_key: string;
  version: number;
  source: "upload" | "result";
  source_job_id: string | null;
  format: "png" | "jpeg" | "webp" | "mp4" | "wav" | "mp3";
  bytes: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  has_alpha: number;
  state: "quarantined" | "ready" | "deleting" | "deleted";
  validated_at: number;
  expires_at: number;
  deleted_at: number | null;
}
export async function mediaDatabase<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    // SQLパラメータやprovider本文を応答/ログへ出さない。
    const message = error instanceof Error ? error.message : "";
    if (message.includes("MEDIA_LIMIT_REACHED"))
      throw new ApiError(429, "media_limit_reached");
    if (message.includes("MEDIA_REQUEST_CONFLICT"))
      throw new ApiError(409, "media_request_conflict");
    if (message.includes("MEDIA_RECOVERY_BLOCKED"))
      throw new ApiError(503, "media_recovery_blocked");
    throw new ApiError(503, "media_ledger_unavailable");
  }
}
export async function ownedMediaJob(db: D1Database, owner: string, id: string) {
  const row = await mediaDatabase(
    db
      .prepare("SELECT * FROM media_jobs WHERE id=? AND owner_id=?")
      .bind(id, owner)
      .first<MediaJob>(),
  );
  if (
    !row ||
    (row.terminal_at !== null &&
      row.terminal_at + MEDIA_LIMITS.ledgerRetentionMs <= Date.now())
  )
    throw new ApiError(404, "not_found");
  return row;
}
export function getMediaRequest(db: D1Database, owner: string, key: string) {
  return mediaDatabase(
    db
      .prepare("SELECT * FROM media_jobs WHERE owner_id=? AND request_key=?")
      .bind(owner, key)
      .first<MediaJob>(),
  );
}
export async function requireMediaRecoveryReady(db: D1Database) {
  const row = await mediaDatabase(
    db
      .prepare("SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1")
      .first<{ is_recovery_blocked: number }>(),
  );
  if (row?.is_recovery_blocked !== 0)
    throw new ApiError(503, "media_recovery_blocked");
}
export async function validateReferences(
  db: D1Database,
  owner: string,
  media: NormalizedMedia,
  now: number,
) {
  const assets: MediaAsset[] = [];
  for (const reference of media.references) {
    const asset = await mediaDatabase(
      db
        .prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?")
        .bind(reference.id, owner)
        .first<MediaAsset>(),
    );
    if (asset?.state !== "ready" || asset.expires_at < now + 30 * 60_000)
      throw new ApiError(400, "media_reference_unavailable");
    if (
      !["png", "jpeg", "webp"].includes(asset.format) ||
      asset.bytes > 10 * 1024 * 1024 ||
      !asset.width ||
      !asset.height ||
      Math.max(asset.width, asset.height) > 4096 ||
      asset.width * asset.height > 8294400
    )
      throw new ApiError(400, "media_reference_invalid");
    assets.push(asset);
  }
  if (
    assets.reduce((total, asset) => total + asset.bytes, 0) >
    MEDIA_LIMITS.referenceBytes
  )
    throw new ApiError(400, "media_reference_bytes_limit");
  const maskIndex = media.references.findIndex(
    (reference) => reference.role === "mask",
  );
  if (maskIndex !== -1) {
    const target = assets[0];
    const mask = assets[maskIndex];
    if (
      target.format !== "png" ||
      mask.format !== "png" ||
      !mask.has_alpha ||
      mask.width !== target.width ||
      mask.height !== target.height
    )
      throw new ApiError(400, "media_mask_invalid");
  }
  return assets;
}
export async function reserveMedia(
  db: D1Database,
  owner: string,
  media: NormalizedMedia,
  hash: string,
  assets: MediaAsset[],
  now: number,
) {
  if (
    media.request.requestId.slice(0, 10) !==
    new Date(now).toISOString().slice(0, 10)
  )
    throw new ApiError(400, "media_request_day_mismatch");
  const id = crypto.randomUUID();
  const assetConditions = assets.map(
    () =>
      "EXISTS(SELECT 1 FROM media_assets WHERE id=? AND owner_id=? AND version=? AND state='ready' AND expires_at>=?)",
  );
  const insert = db
    .prepare(`INSERT INTO media_jobs(id,owner_id,request_key,request_uuid,input_hash,model_id,catalog_version,kind,quantity,reserved_bytes,provider_state,next_poll_at,monitor_until,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,'reserved',?,?,?,? WHERE ${assetConditions.join(" AND ") || "1"}
    ON CONFLICT(owner_id,request_key) DO NOTHING`)
    .bind(
      id,
      owner,
      media.request.requestId,
      media.request.requestId.slice(11),
      hash,
      media.model.id,
      media.model.version,
      media.model.kind,
      media.quantity,
      media.reservedBytes,
      now,
      now + MEDIA_LIMITS.monitorMs,
      now,
      now,
      ...assets.flatMap((asset) => [
        asset.id,
        owner,
        asset.version,
        now + 30 * 60_000,
      ]),
    );
  const statements = [
    insert,
    db
      .prepare(
        "INSERT INTO media_job_bodies SELECT id,owner_id,? FROM media_jobs WHERE id=?",
      )
      .bind(JSON.stringify(media.input), id),
    ...assets.map((asset, index) =>
      db
        .prepare(
          "INSERT INTO media_job_assets SELECT id,?,?,?,?,?,? FROM media_jobs WHERE id=?",
        )
        .bind(
          asset.id,
          owner,
          media.references[index].role,
          media.references[index].ordinal,
          asset.version,
          media.references[index].role === "mask" ? assets[0].id : null,
          id,
        ),
    ),
  ];
  const result = await mediaDatabase(db.batch(statements));
  // D1のchangesにはAFTER INSERTの利用/容量予約も含まれる。
  if (result[0].meta.changes === 0) {
    const existing = await getMediaRequest(db, owner, media.request.requestId);
    if (existing) {
      if (existing.input_hash !== hash)
        throw new ApiError(409, "idempotency_conflict");
      return { job: existing, isNew: false };
    }
    throw new ApiError(409, "media_reservation_conflict");
  }
  return { job: await ownedMediaJob(db, owner, id), isNew: true };
}
export async function claimMediaSubmission(
  db: D1Database,
  job: MediaJob,
  now: number,
) {
  const result = await mediaDatabase(
    db
      .prepare(
        `UPDATE media_jobs SET provider_state='submitting',attempt_count=1,lease_token=?,lease_until=?,updated_at=? WHERE id=? AND owner_id=? AND provider_state='reserved' AND attempt_count=0 AND terminal_at IS NULL AND cancel_requested_at IS NULL AND body_erased_at IS NULL AND created_at+30000>? AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0`,
      )
      .bind(
        crypto.randomUUID(),
        now + MEDIA_LIMITS.leaseMs,
        now,
        job.id,
        job.owner_id,
        now,
      )
      .run(),
  );
  if (result.meta.changes !== 1)
    throw new ApiError(409, "media_submission_not_claimed");
  return ownedMediaJob(db, job.owner_id, job.id);
}
export async function claimMediaLease(
  db: D1Database,
  job: MediaJob,
  now: number,
) {
  const token = crypto.randomUUID();
  const result = await mediaDatabase(
    db
      .prepare(
        `UPDATE media_jobs SET lease_token=?,lease_until=? WHERE id=? AND owner_id=? AND terminal_at IS NULL AND attempt_count=1 AND provider_id IS NOT NULL AND next_poll_at<=? AND monitor_until>? AND (lease_until IS NULL OR lease_until<=?) AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0`,
      )
      .bind(
        token,
        now + MEDIA_LIMITS.leaseMs,
        job.id,
        job.owner_id,
        now,
        now,
        now,
      )
      .run(),
  );
  if (result.meta.changes !== 1) return null;
  return token;
}
export async function expireMediaSubmissions(db: D1Database, now: number) {
  // 受付不明は終端化/再送/枠解放しない。未送信reservedだけ確実な失敗にできる。
  await mediaDatabase(
    db.batch([
      db
        .prepare(
          `UPDATE media_jobs SET provider_state='failed',collection_state='discarded',terminal_outcome='failed',terminal_at=?,updated_at=?,lease_token=NULL,lease_until=NULL WHERE id IN (SELECT id FROM media_jobs WHERE provider_state='reserved' AND created_at+30000<=? LIMIT 100)`,
        )
        .bind(now, now, now),
      db
        .prepare(
          `UPDATE media_jobs SET provider_state='submission_unknown',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id IN (SELECT id FROM media_jobs WHERE provider_state='submitting' AND lease_until<=? LIMIT 100)`,
        )
        .bind(now, now),
      db.prepare(
        `UPDATE media_storage_reservations SET held_bytes=0,state='released' WHERE state='reserved' AND job_id IN (SELECT id FROM media_jobs WHERE terminal_outcome='failed' AND attempt_count=0)`,
      ),
    ]),
  );
}
