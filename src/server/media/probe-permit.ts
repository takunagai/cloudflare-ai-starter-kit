import { checkExtensionRuntimePolicy } from "../ai-verification";
import type { Identity } from "../env";
import { ApiError } from "../http";
import type { NormalizedMedia } from "./catalog";
import type { MediaEnv } from "./policy";

export const PROBE_APPROVAL_VERSION = "e-sunburst-20261005-v1";
export const PROBE_ACCESS_LIFETIME_SECONDS = 6 * 60 * 60;
export const PROBE_MODEL = "openai/gpt-image-2.5/sunburst/text-to-image";
export const PROBE_PROMPT =
  "架空のWebページ用の画像。白い背景に、青い陶器の立方体、黄色い紙の円柱、緑のガラス球を並べた静物。柔らかな斜光、中央に三つの形、周囲に十分な余白。文字、人、ロゴ、実在の商品や建物は描かない。";
export const PROBE_CLOCK = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
const PERMITS = new WeakSet<object>();
export interface MediaProbePermit {
  readonly environment: MediaEnv;
  readonly owner: string;
  readonly requestKey: string;
  readonly jobId?: string;
}
export interface ProbeRun {
  approval_version: string;
  owner_id: string;
  app_origin: string;
  started_at: number;
  expires_at: number;
  used_attempts: number;
  max_attempts: number;
  is_stopped: number;
  is_closed: number;
  stopped_at: number | null;
  revision: number;
}
export async function probeDatabase<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch {
    throw new ApiError(503, "media_probe_ledger_unavailable");
  }
}
function isEmptyList(value: string | undefined) {
  try {
    const list: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(list) && list.length === 0;
  } catch {
    return false;
  }
}
export function requireProbeConfiguration(environment: MediaEnv) {
  if (environment.ENABLE_MEDIA_PROBE !== "true")
    throw new ApiError(404, "media_probe_disabled");
  if (
    environment.MEDIA_PROBE_APPROVAL_VERSION !== PROBE_APPROVAL_VERSION ||
    environment.APP_ENV !== "staging" ||
    environment.STAGING_POLICY !== "standard" ||
    environment.AUTH_MODE !== "access" ||
    environment.LOCAL_DEMO === "true" ||
    environment.AI_MODE !== "off" ||
    (environment.JEV_MODE ?? "off") !== "off" ||
    !isEmptyList(environment.AI_ALLOWED_MODELS) ||
    !isEmptyList(environment.MEDIA_ALLOWED_MODELS) ||
    !isEmptyList(environment.MEDIA_VERIFIED_IMAGE_MODELS) ||
    !isEmptyList(environment.MEDIA_VERIFIED_VIDEO_MODELS) ||
    !isEmptyList(environment.MEDIA_VERIFIED_AUDIO_MODELS) ||
    [
      environment.ENABLE_MEDIA,
      environment.ENABLE_IMAGES,
      environment.ENABLE_RAG,
      environment.ENABLE_AGENT,
      environment.ENABLE_WORKFLOWS,
      environment.ENABLE_BILLING,
    ].some((flag) => (flag ?? "false") !== "false") ||
    !environment.FAL_KEY ||
    !environment.MEDIA_BUCKET ||
    environment.MEDIA_BUCKET === environment.RAG_BUCKET
  )
    throw new ApiError(503, "media_probe_configuration_invalid");
}
export function assertProbePermit(
  permit: MediaProbePermit,
  environment: MediaEnv,
  model = PROBE_MODEL,
) {
  if (
    !PERMITS.has(permit) ||
    permit.environment !== environment ||
    model !== PROBE_MODEL
  )
    throw new ApiError(403, "media_probe_not_authorized");
  requireProbeConfiguration(environment);
}
export async function readProbeRun(environment: MediaEnv, owner: string) {
  requireProbeConfiguration(environment);
  await checkExtensionRuntimePolicy(environment);
  const run = await probeDatabase(
    environment.DB.prepare(
      `SELECT r.*,${PROBE_CLOCK} AS database_now FROM media_probe_run r WHERE id=1 AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0`,
    ).first<ProbeRun & { database_now: number }>(),
  );
  if (
    !run ||
    run.approval_version !== PROBE_APPROVAL_VERSION ||
    run.app_origin !== environment.APP_ORIGIN
  )
    throw new ApiError(503, "media_probe_not_registered");
  if (run.owner_id !== owner || run.is_closed !== 0)
    throw new ApiError(403, "media_probe_not_authorized");
  if (run.database_now >= (run.stopped_at ?? run.expires_at) + 86400000)
    throw new ApiError(403, "media_probe_reconciliation_expired");
  return run;
}
/** 承認の作成は認証済み専用routeだけ。HTTPのフラグやdriverは使わない。 */
export async function authorizeMediaProbe(
  environment: MediaEnv,
  identity: Identity,
  requestKey: string,
  jobId?: string,
): Promise<MediaProbePermit> {
  await readProbeRun(environment, identity.id);
  const slot = await probeDatabase(
    environment.DB.prepare(
      "SELECT request_key FROM media_probe_slots WHERE run_id=1 AND slot=1 AND request_key=?",
    )
      .bind(requestKey)
      .first(),
  );
  if (!slot) throw new ApiError(409, "media_probe_slot_mismatch");
  if (jobId) {
    const attempt = await probeDatabase(
      environment.DB.prepare(
        "SELECT job_id FROM media_probe_attempts WHERE job_id=? AND owner_id=? AND request_key=?",
      )
        .bind(jobId, identity.id, requestKey)
        .first(),
    );
    if (!attempt) throw new ApiError(404, "not_found");
  }
  const permit = Object.freeze({
    environment,
    owner: identity.id,
    requestKey,
    jobId,
  });
  PERMITS.add(permit);
  return permit;
}
export async function checkProbeExecution(
  permit: MediaProbePermit,
  environment: MediaEnv,
  owner: string,
  model: string,
) {
  assertProbePermit(permit, environment, model);
  if (permit.owner !== owner)
    throw new ApiError(403, "media_probe_not_authorized");
  return readProbeRun(environment, owner);
}
export function probeInput(requestKey: string) {
  return {
    requestId: requestKey,
    model: PROBE_MODEL,
    input: {
      prompt: PROBE_PROMPT,
      size: { width: 1024, height: 1024 },
      quality: "medium",
      count: 1,
      format: "png",
      background: "opaque",
    },
  };
}
export function probeReservationStatement(
  permit: MediaProbePermit,
  jobId: string,
  media: NormalizedMedia,
  hash: string,
) {
  assertProbePermit(permit, permit.environment, media.model.id);
  if (media.request.requestId !== permit.requestKey || media.references.length)
    throw new ApiError(403, "media_probe_not_authorized");
  return permit.environment.DB.prepare(
    `INSERT INTO media_probe_attempts(job_id,owner_id,slot,request_key,input_hash,consumed_at) SELECT id,owner_id,1,request_key,input_hash,${PROBE_CLOCK} FROM media_jobs WHERE id=? AND input_hash=?`,
  ).bind(jobId, hash);
}
export async function stopMediaProbe(environment: MediaEnv, owner: string) {
  await readProbeRun(environment, owner);
  await probeDatabase(
    environment.DB.prepare(
      `UPDATE media_probe_run SET is_stopped=1,stopped_at=COALESCE(stopped_at,${PROBE_CLOCK}),revision=revision+1 WHERE id=1 AND owner_id=?`,
    )
      .bind(owner)
      .run(),
  );
}
export async function claimProbeDispatch(
  permit: MediaProbePermit,
  jobId: string,
) {
  assertProbePermit(permit, permit.environment);
  const claim = crypto.randomUUID();
  const result = await probeDatabase(
    permit.environment.DB.prepare(
      `UPDATE media_probe_attempts SET dispatch_claim=?,dispatched_at=${PROBE_CLOCK} WHERE job_id=? AND owner_id=? AND dispatch_claim IS NULL RETURNING job_id`,
    )
      .bind(claim, jobId, permit.owner)
      .all<{ job_id: string }>(),
  );
  if (result.results.length !== 1)
    throw new ApiError(409, "media_probe_dispatch_not_claimed");
  return claim;
}
export async function assertProbeJobReadable(
  database: D1Database,
  owner: string,
  jobId: string,
) {
  const exists = await probeDatabase(
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='media_probe_attempts'",
      )
      .first(),
  );
  if (!exists) return;
  const closed = await probeDatabase(
    database
      .prepare(
        `SELECT 1 AS closed FROM media_probe_attempts a WHERE a.job_id=? AND a.owner_id=? AND NOT EXISTS(SELECT 1 FROM media_probe_run r WHERE r.id=1 AND r.owner_id=a.owner_id AND r.is_closed=0 AND ${PROBE_CLOCK}<COALESCE(r.stopped_at,r.expires_at)+86400000)`,
      )
      .bind(jobId, owner)
      .first(),
  );
  if (closed) throw new ApiError(404, "not_found");
}
export async function isProbeJob(database: D1Database, jobId: string) {
  const exists = await probeDatabase(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_probe_attempts'",
      )
      .first(),
  );
  if (!exists) return false;
  return !!(await probeDatabase(
    database
      .prepare("SELECT 1 FROM media_probe_attempts WHERE job_id=?")
      .bind(jobId)
      .first(),
  ));
}
export async function beforeProbeSubmit(
  permit: MediaProbePermit,
  jobId: string,
) {
  await checkProbeExecution(
    permit,
    permit.environment,
    permit.owner,
    PROBE_MODEL,
  );
  const attempt = await probeDatabase(
    permit.environment.DB.prepare(
      `SELECT a.job_id,r.expires_at FROM media_probe_attempts a JOIN media_jobs j ON j.id=a.job_id JOIN media_probe_run r ON r.id=1 WHERE a.job_id=? AND a.owner_id=? AND a.dispatch_claim IS NOT NULL AND r.is_stopped=0 AND r.is_closed=0 AND r.expires_at>${PROBE_CLOCK}+15000 AND j.provider_state='submitting' AND j.attempt_count=1 AND j.lease_token=a.dispatch_claim AND j.lease_until>${PROBE_CLOCK} AND j.cancel_requested_at IS NULL AND j.body_erased_at IS NULL`,
    )
      .bind(jobId, permit.owner)
      .first<{ job_id: string; expires_at: number }>(),
  );
  if (!attempt || Date.now() >= attempt.expires_at - 15000)
    throw new ApiError(409, "media_probe_dispatch_not_claimed");
}
export const PROBE_CALL_LIMITS = {
  status: 180,
  result: 3,
  cancel: 1,
  token: 4,
  acl: 2,
  anonymous: 2,
  diagnostic: 4,
  cleanup_status: 3,
  upstream_delete: 3,
  expiry_observation: 1,
  token_observation: 1,
} as const;
export type ProbeOperation = keyof typeof PROBE_CALL_LIMITS;
export async function reserveProbeCall(
  permit: MediaProbePermit,
  operation: ProbeOperation,
  jobId = permit.jobId,
) {
  await checkProbeExecution(
    permit,
    permit.environment,
    permit.owner,
    PROBE_MODEL,
  );
  if (!jobId || (permit.jobId && jobId !== permit.jobId))
    throw new ApiError(403, "media_probe_not_authorized");
  const interval = operation === "status" ? 20000 : 0;
  const result = await probeDatabase(
    permit.environment.DB.prepare(
      `INSERT INTO media_probe_calls(job_id,operation,count,last_at)
    SELECT a.job_id,?,1,${PROBE_CLOCK} FROM media_probe_attempts a JOIN media_jobs j ON j.id=a.job_id
    WHERE a.job_id=? AND a.owner_id=? AND j.provider_id IS NOT NULL
    ${operation === "status" || operation === "result" ? `AND j.created_at+3600000>${PROBE_CLOCK}` : ""}
    ON CONFLICT(job_id,operation) DO UPDATE SET count=count+1,last_at=${PROBE_CLOCK}
    WHERE count<? AND last_at+?<=${PROBE_CLOCK}`,
    )
      .bind(
        operation,
        jobId,
        permit.owner,
        PROBE_CALL_LIMITS[operation],
        interval,
      )
      .run(),
  );
  if (result.meta.changes !== 1)
    throw new ApiError(429, "media_probe_call_limit");
}
export async function closedProbeJobs(database: D1Database, owner: string) {
  const exists = await probeDatabase(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_probe_attempts'",
      )
      .first(),
  );
  if (!exists) return new Set<string>();
  const rows = await probeDatabase(
    database
      .prepare(
        `SELECT job_id FROM media_probe_attempts a WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM media_probe_run r WHERE r.id=1 AND r.owner_id=a.owner_id AND r.is_closed=0 AND ${PROBE_CLOCK}<COALESCE(r.stopped_at,r.expires_at)+86400000)`,
      )
      .bind(owner)
      .all<{ job_id: string }>(),
  );
  return new Set(rows.results.map((row) => row.job_id));
}
export async function recordProbeEvidence(
  permit: MediaProbePermit,
  item: string,
  verdict: string,
) {
  if (!permit.jobId) throw new ApiError(403, "media_probe_not_authorized");
  await checkProbeExecution(
    permit,
    permit.environment,
    permit.owner,
    PROBE_MODEL,
  );
  await probeDatabase(
    permit.environment.DB.prepare(
      `INSERT INTO media_probe_evidence(job_id,item,verdict,observed_at) VALUES(?,?,?,${PROBE_CLOCK}) ON CONFLICT(job_id,item) DO UPDATE SET verdict=excluded.verdict,observed_at=excluded.observed_at WHERE media_probe_evidence.verdict!='fail'`,
    )
      .bind(permit.jobId, item, verdict)
      .run(),
  );
  if (verdict === "unknown" || verdict === "fail")
    await stopMediaProbe(permit.environment, permit.owner);
}
export async function closeMediaProbe(environment: MediaEnv, owner: string) {
  await stopMediaProbe(environment, owner);
  const result = await probeDatabase(
    environment.DB.prepare(
      `UPDATE media_probe_run SET is_closed=1,revision=revision+1 WHERE id=1 AND owner_id=?
    AND NOT EXISTS(SELECT 1 FROM media_probe_attempts WHERE terminal_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM media_probe_attempts a JOIN media_jobs j ON j.id=a.job_id WHERE j.terminal_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM media_storage_reservations s JOIN media_probe_attempts a ON a.job_id=s.job_id WHERE s.held_bytes>0)
    AND NOT EXISTS(SELECT 1 FROM media_output_objects o JOIN media_probe_attempts a ON a.job_id=o.job_id WHERE o.state!='deleted')`,
    )
      .bind(owner)
      .run(),
  );
  if (result.meta.changes !== 1)
    throw new ApiError(409, "media_probe_unresolved");
  return { isClosed: true };
}
export async function probeRecoveryWitness(database: D1Database) {
  const exists = await probeDatabase(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_probe_run'",
      )
      .first(),
  );
  if (!exists) return undefined;
  const rows = await probeDatabase(
    database.batch([
      database.prepare("SELECT * FROM media_probe_run ORDER BY id"),
      database.prepare("SELECT * FROM media_probe_slots ORDER BY slot"),
      database.prepare(
        "SELECT * FROM media_probe_attempts ORDER BY job_id LIMIT 3",
      ),
      database.prepare(
        "SELECT * FROM media_probe_calls ORDER BY job_id,operation LIMIT 30",
      ),
      database.prepare(
        "SELECT * FROM media_probe_evidence ORDER BY job_id,item LIMIT 20",
      ),
      database.prepare(
        "SELECT job_id,observed_at FROM media_probe_output ORDER BY job_id LIMIT 3",
      ),
    ]),
  );
  return rows.every((row) => row.results.length === 0)
    ? undefined
    : rows.map((row) => row.results);
}
export async function maintainProbeRetention(
  database: D1Database,
  now: number,
) {
  const exists = await probeDatabase(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_probe_run'",
      )
      .first(),
  );
  if (!exists) return;
  const eligible = await probeDatabase(
    database
      .prepare(
        "SELECT 1 FROM media_probe_run WHERE id=1 AND is_closed=1 AND EXISTS(SELECT 1 FROM media_probe_attempts) AND NOT EXISTS(SELECT 1 FROM media_probe_attempts WHERE terminal_at IS NULL OR terminal_at>?)",
      )
      .bind(now - 90 * 86400000)
      .first(),
  );
  if (!eligible) return;
  await probeDatabase(
    database.batch([
      database.prepare("DELETE FROM media_probe_evidence"),
      database.prepare("DELETE FROM media_probe_calls"),
      database.prepare("DELETE FROM media_probe_output"),
      database.prepare("DELETE FROM media_probe_attempts"),
      database.prepare("DELETE FROM media_probe_slots"),
      database.prepare("DELETE FROM media_probe_run"),
    ]),
  );
}
