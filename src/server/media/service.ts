import { z } from "zod";
import type { Identity } from "../env";
import { ApiError } from "../http";
import {
  MEDIA_LIMITS,
  mediaModel,
  type NormalizedMedia,
  normalizeMedia,
} from "./catalog";
import {
  claimMediaLease,
  claimMediaSubmission,
  getMediaRequest,
  type MediaAsset,
  type MediaJob,
  mediaDatabase,
  ownedMediaJob,
  requireMediaRecoveryReady,
  reserveMedia,
  validateReferences,
} from "./ledger";
import {
  checkMediaExecution,
  type MediaEnv,
  requireMediaEnabled,
} from "./policy";

/** 媒体別adapterが検査/保存したreceiptだけを渡す内部境界。HTTPからは受け付けない。 */
export interface MediaReceipt {
  id: string;
  ordinal: number;
  objectKey: string;
  format: MediaAsset["format"];
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  hasAlpha?: boolean;
  validatedAt: number;
}
export interface MediaDriver {
  submit(
    media: NormalizedMedia,
    context: {
      jobId: string;
      signal: AbortSignal;
      headers: Readonly<Record<string, string>>;
    },
  ): Promise<
    { outcome: "accepted"; requestId: string } | { outcome: "rejected" }
  >;
  status(
    job: Readonly<MediaJob>,
    signal: AbortSignal,
  ): Promise<"queued" | "running" | "completed" | "failed" | "cancelled">;
  cancel(job: Readonly<MediaJob>, signal: AbortSignal): Promise<void>;
  collect(
    job: Readonly<MediaJob>,
    signal: AbortSignal,
  ): Promise<{
    assets: MediaReceipt[];
    isComplete: boolean;
    hasInvalidOutput: boolean;
  }>;
  // 成功はジョブ配下の部分保存・隔離・孤立objectを含む物理削除の確認。
  discard(job: Readonly<MediaJob>, signal: AbortSignal): Promise<void>;
}
export const MEDIA_SUBMISSION_HEADERS = Object.freeze({
  "X-Fal-Request-Timeout": "120",
  "X-Fal-No-Retry": "1",
  "x-app-fal-disable-fallback": "true",
  "X-Fal-Store-IO": "0",
  "X-Fal-Object-Lifecycle-Preference": JSON.stringify({
    expiration_duration_seconds: 3600,
    initial_acl: { default: "forbid", rules: [] },
  }),
} as const);
export interface MediaContext {
  env: MediaEnv;
  identity: Identity;
  driver?: MediaDriver;
  timeoutMs?: number;
}
async function timedOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ApiError(502, "media_provider_unavailable"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function mediaMetadata(job: MediaJob, now = Date.now()) {
  return {
    id: job.id,
    requestId: job.request_key,
    model: job.model_id,
    catalogVersion: job.catalog_version,
    kind: job.kind,
    providerState: job.provider_state,
    collectionState: job.collection_state,
    terminalOutcome: job.terminal_outcome,
    createdAt: job.created_at,
    terminalAt: job.terminal_at,
    bodyAvailable:
      job.body_erased_at === null &&
      (job.terminal_at === null ||
        job.terminal_at + MEDIA_LIMITS.bodyRetentionMs > now),
    isCancellationRequested: job.cancel_requested_at !== null,
    isUncertain:
      job.terminal_at === null &&
      (job.provider_state === "submission_unknown" ||
        job.monitor_until <= now ||
        (job.provider_state === "submitting" && (job.lease_until ?? 0) <= now)),
  };
}
export async function getMediaJob(
  env: MediaEnv,
  identity: Identity,
  id: string,
) {
  const job = await ownedMediaJob(env.DB, identity.id, id);
  const metadata = mediaMetadata(job);
  const body = metadata.bodyAvailable
    ? await mediaDatabase(
        env.DB.prepare(
          "SELECT input_json FROM media_job_bodies WHERE job_id=? AND owner_id=?",
        )
          .bind(id, identity.id)
          .first<{ input_json: string }>(),
      )
    : null;
  const assets = await mediaDatabase(
    env.DB.prepare(
      "SELECT a.id,a.format,a.state,a.expires_at FROM media_assets a JOIN media_job_assets j ON a.id=j.asset_id AND a.owner_id=j.owner_id WHERE j.job_id=? AND j.owner_id=? AND j.role='output' ORDER BY j.ordinal",
    )
      .bind(id, identity.id)
      .all<{ id: string; format: string; state: string; expires_at: number }>(),
  );
  return {
    ...metadata,
    bodyAvailable: metadata.bodyAvailable && body !== null,
    input: body ? (JSON.parse(body.input_json) as unknown) : null,
    assets: assets.results,
  };
}
export async function listMediaJobs(env: MediaEnv, identity: Identity) {
  const now = Date.now();
  const result = await mediaDatabase(
    env.DB.prepare(
      "SELECT * FROM media_jobs WHERE owner_id=? AND (terminal_at IS NULL OR terminal_at>?) ORDER BY created_at DESC LIMIT 50",
    )
      .bind(identity.id, now - MEDIA_LIMITS.ledgerRetentionMs)
      .all<MediaJob>(),
  );
  const legacy = await mediaDatabase(
    env.DB.prepare(
      "SELECT id,model,state,created_at FROM image_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(identity.id)
      .all<{ id: string; model: string; state: string; created_at: number }>(),
  );
  return {
    jobs: [
      ...result.results.map((job) => ({
        ...mediaMetadata(job),
        isLegacy: false,
      })),
      ...legacy.results.map((job) => ({
        id: job.id,
        model: job.model,
        providerState: job.state,
        createdAt: job.created_at,
        isLegacy: true,
        collectionState: "legacy_external_url",
        isPrivatelyStored: false,
      })),
    ]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 50),
  };
}
async function inputHash(media: NormalizedMedia) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        version: media.model.version,
        model: media.model.id,
        input: media.input,
      }),
    ),
  );
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
async function finishUnstored(
  db: D1Database,
  job: MediaJob,
  token: string,
  state: "failed" | "cancelled",
  now: number,
) {
  const result = await mediaDatabase(
    db.batch([
      db
        .prepare(`UPDATE media_jobs SET provider_state=?,collection_state='discarded',terminal_outcome=?,terminal_at=?,updated_at=?,lease_token=NULL,lease_until=NULL
      WHERE id=? AND owner_id=? AND terminal_at IS NULL AND lease_token=? AND lease_until>? AND NOT EXISTS(SELECT 1 FROM media_job_assets WHERE job_id=? AND role='output')`)
        .bind(state, state, now, now, job.id, job.owner_id, token, now, job.id),
      db
        .prepare(
          "UPDATE media_storage_reservations SET held_bytes=0,state='released' WHERE job_id=? AND EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND terminal_at=? AND terminal_outcome=?)",
        )
        .bind(job.id, job.id, now, state),
    ]),
  );
  if (result[0].meta.changes !== 1)
    throw new ApiError(503, "media_ledger_unavailable");
}
export async function submitMedia(context: MediaContext, raw: unknown) {
  const { env, identity, driver } = context;
  requireMediaEnabled(env);
  const media = normalizeMedia(raw);
  const hash = await inputHash(media);
  const existing = await getMediaRequest(
    env.DB,
    identity.id,
    media.request.requestId,
  );
  if (existing) {
    if (existing.input_hash !== hash)
      throw new ApiError(409, "idempotency_conflict");
    if (
      existing.terminal_at !== null &&
      existing.terminal_at + MEDIA_LIMITS.ledgerRetentionMs <= Date.now()
    )
      throw new ApiError(409, "media_request_expired");
    return mediaMetadata(existing);
  }
  await checkMediaExecution(env, media.model.id);
  await requireMediaRecoveryReady(env.DB);
  if (!driver) throw new ApiError(503, "media_adapter_not_ready");
  const assets = await validateReferences(
    env.DB,
    identity.id,
    media,
    Date.now(),
  );
  const reservation = await reserveMedia(
    env.DB,
    identity.id,
    media,
    hash,
    assets,
    Date.now(),
  );
  if (!reservation.isNew) return mediaMetadata(reservation.job);
  const job = await claimMediaSubmission(env.DB, reservation.job, Date.now());
  let hasDispatched = false;
  try {
    await checkMediaExecution(env, media.model.id);
    await requireMediaRecoveryReady(env.DB);
    const current = await ownedMediaJob(env.DB, identity.id, job.id);
    if (
      current.cancel_requested_at !== null ||
      current.body_erased_at !== null ||
      (current.lease_until ?? 0) <= Date.now()
    )
      throw new ApiError(409, "media_submission_not_claimed");
    await validateReferences(env.DB, identity.id, media, Date.now());
    hasDispatched = true;
    const acknowledgement = await timedOperation(
      (signal) =>
        driver.submit(media, {
          jobId: job.id,
          signal,
          headers: MEDIA_SUBMISSION_HEADERS,
        }),
      context.timeoutMs,
    );
    if (acknowledgement.outcome === "rejected") {
      await finishUnstored(
        env.DB,
        job,
        job.lease_token ?? "",
        "failed",
        Date.now(),
      );
      throw new ApiError(502, "media_submission_rejected");
    }
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(acknowledgement.requestId))
      throw new ApiError(502, "media_provider_response_invalid");
    const now = Date.now();
    const result = await mediaDatabase(
      env.DB.prepare(
        "UPDATE media_jobs SET provider_id=?,provider_state='queued',next_poll_at=?,updated_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND provider_state='submitting' AND lease_token=? AND lease_until>? AND terminal_at IS NULL",
      )
        .bind(
          acknowledgement.requestId,
          now + 5000,
          now,
          job.id,
          identity.id,
          job.lease_token,
          now,
        )
        .run(),
    );
    if (result.meta.changes !== 1)
      throw new ApiError(503, "media_ledger_unavailable");
  } catch (error) {
    if (!hasDispatched)
      await finishUnstored(
        env.DB,
        job,
        job.lease_token ?? "",
        "failed",
        Date.now(),
      );
    else
      await mediaDatabase(
        env.DB.prepare(
          "UPDATE media_jobs SET provider_state='submission_unknown',updated_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND provider_state='submitting' AND lease_token=? AND terminal_at IS NULL",
        )
          .bind(Date.now(), job.id, identity.id, job.lease_token)
          .run(),
      );
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "media_submission_unknown");
  }
  return mediaMetadata(await ownedMediaJob(env.DB, identity.id, job.id));
}
export async function requestMediaCancellation(
  env: MediaEnv,
  identity: Identity,
  id: string,
) {
  const job = await ownedMediaJob(env.DB, identity.id, id);
  if (job.terminal_at !== null)
    throw new ApiError(409, "media_not_cancellable");
  // OFFでも意図は記録できる。provider通信は有効化/許可/leaseを別途通す。
  await mediaDatabase(
    env.DB.prepare(
      "UPDATE media_jobs SET cancel_requested_at=COALESCE(cancel_requested_at,?),updated_at=? WHERE id=? AND owner_id=? AND terminal_at IS NULL",
    )
      .bind(Date.now(), Date.now(), id, identity.id)
      .run(),
  );
  return mediaMetadata(await ownedMediaJob(env.DB, identity.id, id));
}
const RECEIPT_SCHEMA = z.strictObject({
  id: z.uuid(),
  ordinal: z.number().int().min(0).max(3),
  objectKey: z.string().max(200),
  format: z.enum(["png", "jpeg", "webp", "mp4", "wav", "mp3"]),
  bytes: z.number().int().positive().max(MEDIA_LIMITS.videoBytes),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().positive().finite().optional(),
  hasAlpha: z.boolean().optional(),
  validatedAt: z.number().int().nonnegative(),
});
async function recordReceipts(
  db: D1Database,
  job: MediaJob,
  token: string,
  raw: MediaReceipt[],
  isComplete: boolean,
  now: number,
) {
  const parsed = z
    .array(RECEIPT_SCHEMA)
    .max(job.kind === "image" ? job.quantity : 1)
    .safeParse(raw);
  if (!parsed.success) throw new ApiError(502, "media_result_invalid");
  const model = mediaModel(job.model_id);
  const body = await mediaDatabase(
    db
      .prepare(
        "SELECT input_json FROM media_job_bodies WHERE job_id=? AND owner_id=?",
      )
      .bind(job.id, job.owner_id)
      .first<{ input_json: string }>(),
  );
  const requestedFormat = body
    ? (JSON.parse(body.input_json) as { format?: string }).format
    : undefined;
  const maximumBytes =
    job.kind === "image"
      ? MEDIA_LIMITS.imageBytes
      : job.kind === "video"
        ? MEDIA_LIMITS.videoBytes
        : MEDIA_LIMITS.audioBytes;
  for (const asset of parsed.data) {
    if (
      asset.ordinal >= (job.kind === "image" ? job.quantity : 1) ||
      asset.objectKey !== `media/results/${job.id}/${asset.ordinal}` ||
      !model.output.formats.includes(asset.format) ||
      (job.kind === "image" &&
        requestedFormat !== undefined &&
        asset.format !== requestedFormat) ||
      asset.bytes > maximumBytes ||
      asset.validatedAt < job.created_at ||
      asset.validatedAt > now
    )
      throw new ApiError(502, "media_result_invalid");
    if (
      job.kind === "image" &&
      (!asset.width ||
        !asset.height ||
        Math.max(asset.width, asset.height) > 3840 ||
        asset.width * asset.height > 8294400 ||
        asset.width * asset.height < 655360 ||
        asset.width % 16 !== 0 ||
        asset.height % 16 !== 0 ||
        Math.max(asset.width, asset.height) /
          Math.min(asset.width, asset.height) >
          3)
    )
      throw new ApiError(502, "media_result_invalid");
  }
  if (
    new Set(parsed.data.map((asset) => asset.ordinal)).size !==
      parsed.data.length ||
    new Set(parsed.data.map((asset) => asset.id)).size !== parsed.data.length
  )
    throw new ApiError(502, "media_result_invalid");
  const statements: D1PreparedStatement[] = [];
  for (const asset of parsed.data) {
    // INSERTの一意性により再試行で期限/実量を延長・上書きしない。
    const existing = await mediaDatabase(
      db
        .prepare(
          "SELECT a.* FROM media_assets a JOIN media_job_assets j ON a.id=j.asset_id WHERE j.job_id=? AND j.role='output' AND j.ordinal=?",
        )
        .bind(job.id, asset.ordinal)
        .first<MediaAsset>(),
    );
    const existingId = await mediaDatabase(
      db
        .prepare("SELECT * FROM media_assets WHERE id=?")
        .bind(asset.id)
        .first<MediaAsset>(),
    );
    if (
      existingId &&
      (!existing ||
        existingId.owner_id !== job.owner_id ||
        existingId.source_job_id !== job.id)
    )
      throw new ApiError(502, "media_result_invalid");
    if (
      existing &&
      (existing.state === "deleted" ||
        existing.state === "deleting" ||
        existing.id !== asset.id ||
        existing.object_key !== asset.objectKey ||
        existing.bytes !== asset.bytes ||
        existing.format !== asset.format ||
        existing.validated_at !== asset.validatedAt ||
        existing.width !== (asset.width ?? null) ||
        existing.height !== (asset.height ?? null) ||
        existing.duration !== (asset.duration ?? null) ||
        existing.has_alpha !== (asset.hasAlpha ? 1 : 0))
    )
      throw new ApiError(502, "media_result_invalid");
    statements.push(
      db
        .prepare(`INSERT INTO media_assets(id,owner_id,object_key,version,source,source_job_id,format,bytes,width,height,duration,has_alpha,state,validated_at,expires_at)
      SELECT ?,?,?,1,'result',?,?,?,?,?,?,?,'quarantined',?,? FROM media_jobs WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND terminal_at IS NULL ON CONFLICT(id) DO NOTHING`)
        .bind(
          asset.id,
          job.owner_id,
          asset.objectKey,
          job.id,
          asset.format,
          asset.bytes,
          asset.width ?? null,
          asset.height ?? null,
          asset.duration ?? null,
          asset.hasAlpha ? 1 : 0,
          asset.validatedAt,
          asset.validatedAt + MEDIA_LIMITS.outputLifetimeMs,
          job.id,
          job.owner_id,
          token,
          now,
        ),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO media_job_assets SELECT id,?,owner_id,'output',?,1,NULL FROM media_jobs WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND terminal_at IS NULL ON CONFLICT(job_id,role,ordinal) DO NOTHING",
        )
        .bind(asset.id, asset.ordinal, job.id, job.owner_id, token, now),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE media_jobs SET collection_state=?,updated_at=? WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND terminal_at IS NULL`,
      )
      .bind(
        isComplete ? "collecting" : "collection_failed",
        now,
        job.id,
        job.owner_id,
        token,
        now,
      ),
  );
  const result = await mediaDatabase(db.batch(statements));
  if (result.at(-1)?.meta.changes !== 1)
    throw new ApiError(503, "media_lease_lost");
  const assets = await mediaDatabase(
    db
      .prepare(
        "SELECT a.* FROM media_assets a JOIN media_job_assets j ON a.id=j.asset_id WHERE j.job_id=? AND j.owner_id=? AND j.role='output' ORDER BY j.ordinal",
      )
      .bind(job.id, job.owner_id)
      .all<MediaAsset>(),
  );
  if (
    isComplete &&
    assets.results.length !== (job.kind === "image" ? job.quantity : 1)
  )
    throw new ApiError(502, "media_result_invalid");
}
async function discardCollected(
  context: MediaContext,
  job: MediaJob,
  token: string,
  outcome: "discarded" | "invalid",
) {
  const driver = context.driver;
  if (!driver) throw new ApiError(503, "media_adapter_not_ready");
  await timedOperation(
    (signal) => driver.discard(job, signal),
    context.timeoutMs,
  );
  const now = Date.now();
  const result = await mediaDatabase(
    context.env.DB.batch([
      context.env.DB.prepare(
        "UPDATE media_jobs SET collection_state=?,terminal_outcome=?,terminal_at=?,updated_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND provider_state='completed' AND lease_token=? AND lease_until>? AND terminal_at IS NULL",
      ).bind(
        outcome === "invalid" ? "invalid" : "discarded",
        outcome,
        now,
        now,
        job.id,
        job.owner_id,
        token,
        now,
      ),
      context.env.DB.prepare(
        "UPDATE media_assets SET state='deleted',deleted_at=? WHERE id IN(SELECT asset_id FROM media_job_assets WHERE job_id=? AND role='output') AND EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND terminal_at=? AND terminal_outcome=?)",
      ).bind(now, job.id, job.id, now, outcome),
      context.env.DB.prepare(
        "UPDATE media_storage_reservations SET held_bytes=0,state='released' WHERE job_id=? AND EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND terminal_at=? AND terminal_outcome=?)",
      ).bind(job.id, job.id, now, outcome),
    ]),
  );
  if (result[0].meta.changes !== 1) throw new ApiError(503, "media_lease_lost");
}
export async function advanceMediaJob(context: MediaContext, id: string) {
  const { env, identity, driver } = context;
  let job = await ownedMediaJob(env.DB, identity.id, id);
  if (job.terminal_at !== null) return mediaMetadata(job);
  await checkMediaExecution(env, job.model_id);
  await requireMediaRecoveryReady(env.DB);
  if (!driver) throw new ApiError(503, "media_adapter_not_ready");
  const token = await claimMediaLease(env.DB, job, Date.now());
  if (!token) return mediaMetadata(job);
  try {
    job = await ownedMediaJob(env.DB, identity.id, id);
    await checkMediaExecution(env, job.model_id);
    await requireMediaRecoveryReady(env.DB);
    if (
      job.cancel_requested_at !== null &&
      job.cancel_sent_at === null &&
      job.provider_state !== "completed"
    ) {
      const claimed = await mediaDatabase(
        env.DB.prepare(
          "UPDATE media_jobs SET cancel_sent_at=? WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND cancel_sent_at IS NULL AND terminal_at IS NULL",
        )
          .bind(Date.now(), id, identity.id, token, Date.now())
          .run(),
      );
      if (claimed.meta.changes !== 1)
        throw new ApiError(503, "media_lease_lost");
      await timedOperation(
        (signal) => driver.cancel(job, signal),
        context.timeoutMs,
      );
    }
    if (job.provider_state !== "completed") {
      const status = z
        .enum(["queued", "running", "completed", "failed", "cancelled"])
        .safeParse(
          await timedOperation(
            (signal) => driver.status(job, signal),
            context.timeoutMs,
          ),
        );
      if (!status.success)
        throw new ApiError(502, "media_provider_response_invalid");
      if (status.data === "failed" || status.data === "cancelled") {
        await finishUnstored(env.DB, job, token, status.data, Date.now());
        return mediaMetadata(await ownedMediaJob(env.DB, identity.id, id));
      }
      const changed = await mediaDatabase(
        env.DB.prepare(
          "UPDATE media_jobs SET provider_state=?,updated_at=? WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND terminal_at IS NULL",
        )
          .bind(status.data, Date.now(), id, identity.id, token, Date.now())
          .run(),
      );
      if (changed.meta.changes !== 1)
        throw new ApiError(503, "media_lease_lost");
      if (status.data !== "completed")
        return mediaMetadata(await ownedMediaJob(env.DB, identity.id, id));
    }
    job = await ownedMediaJob(env.DB, identity.id, id);
    if (
      job.cancel_requested_at !== null ||
      job.collection_state === "invalid" ||
      job.collection_state === "deleting"
    ) {
      await discardCollected(
        context,
        job,
        token,
        job.collection_state === "invalid" ? "invalid" : "discarded",
      );
      return mediaMetadata(await ownedMediaJob(env.DB, identity.id, id));
    }
    if (job.collection_attempts >= 3)
      throw new ApiError(409, "media_collection_retry_limit");
    const collecting = await mediaDatabase(
      env.DB.prepare(
        "UPDATE media_jobs SET collection_state='collecting',collection_attempts=collection_attempts+1 WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND terminal_at IS NULL AND collection_attempts<3 AND cancel_requested_at IS NULL",
      )
        .bind(id, identity.id, token, Date.now())
        .run(),
    );
    if (collecting.meta.changes !== 1)
      throw new ApiError(503, "media_lease_lost");
    const collection = await timedOperation(
      (signal) => driver.collect(job, signal),
      context.timeoutMs,
    );
    if (
      typeof collection.isComplete !== "boolean" ||
      typeof collection.hasInvalidOutput !== "boolean"
    )
      throw new ApiError(502, "media_result_invalid");
    try {
      await recordReceipts(
        env.DB,
        job,
        token,
        collection.assets,
        collection.isComplete,
        Date.now(),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "media_result_invalid")
        await mediaDatabase(
          env.DB.prepare(
            "UPDATE media_jobs SET collection_state='invalid' WHERE id=? AND owner_id=? AND lease_token=? AND terminal_at IS NULL",
          )
            .bind(id, identity.id, token)
            .run(),
        );
      throw error;
    }
    if (collection.hasInvalidOutput) {
      await mediaDatabase(
        env.DB.prepare(
          "UPDATE media_jobs SET collection_state='invalid' WHERE id=? AND owner_id=? AND lease_token=? AND terminal_at IS NULL",
        )
          .bind(id, identity.id, token)
          .run(),
      );
      await discardCollected(context, job, token, "invalid");
    } else if (collection.isComplete) {
      const now = Date.now();
      const result = await mediaDatabase(
        env.DB.batch([
          env.DB.prepare(`UPDATE media_jobs SET collection_state=CASE WHEN cancel_requested_at IS NULL THEN 'stored' ELSE 'deleting' END,
          terminal_outcome=CASE WHEN cancel_requested_at IS NULL THEN 'stored' ELSE NULL END,terminal_at=CASE WHEN cancel_requested_at IS NULL THEN ? ELSE NULL END,updated_at=?
          WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND provider_state='completed' AND terminal_at IS NULL`).bind(
            now,
            now,
            id,
            identity.id,
            token,
            now,
          ),
          env.DB.prepare(
            "UPDATE media_assets SET state=CASE WHEN (SELECT cancel_requested_at FROM media_jobs WHERE id=?) IS NULL THEN 'ready' ELSE 'deleting' END WHERE id IN(SELECT asset_id FROM media_job_assets WHERE job_id=? AND role='output') AND EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>?)",
          ).bind(id, id, id, identity.id, token, now),
          env.DB.prepare(
            "UPDATE media_storage_reservations SET held_bytes=(SELECT sum(a.bytes) FROM media_assets a JOIN media_job_assets j ON a.id=j.asset_id WHERE j.job_id=? AND j.role='output'),state=CASE WHEN (SELECT cancel_requested_at FROM media_jobs WHERE id=?) IS NULL THEN 'stored' ELSE 'deleting' END WHERE job_id=? AND EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>?)",
          ).bind(id, id, id, id, identity.id, token, now),
        ]),
      );
      if (result[0].meta.changes !== 1)
        throw new ApiError(503, "media_lease_lost");
      job = await ownedMediaJob(env.DB, identity.id, id);
      if (job.cancel_requested_at !== null)
        await discardCollected(context, job, token, "discarded");
    }
  } catch (error) {
    await mediaDatabase(
      env.DB.prepare(
        "UPDATE media_jobs SET collection_state=? WHERE id=? AND owner_id=? AND lease_token=? AND collection_state='collecting' AND terminal_at IS NULL",
      )
        .bind(
          error instanceof ApiError && error.code === "media_result_invalid"
            ? "invalid"
            : "collection_failed",
          id,
          identity.id,
          token,
        )
        .run(),
    );
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "media_collection_unavailable");
  } finally {
    const now = Date.now();
    await mediaDatabase(
      env.DB.prepare(
        "UPDATE media_jobs SET lease_token=NULL,lease_until=NULL,next_poll_at=?,updated_at=? WHERE id=? AND owner_id=? AND lease_token=?",
      )
        .bind(
          now +
            (job.collection_attempts === 0
              ? 5000
              : job.collection_attempts === 1
                ? 30000
                : 120000),
          now,
          id,
          identity.id,
          token,
        )
        .run(),
    );
  }
  return mediaMetadata(await ownedMediaJob(env.DB, identity.id, id));
}
