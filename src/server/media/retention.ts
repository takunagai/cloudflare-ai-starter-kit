import type { Identity } from "../env";
import { ApiError } from "../http";
import { MEDIA_LIMITS } from "./catalog";
import {
  expireMediaSubmissions,
  type MediaAsset,
  type MediaJob,
  mediaDatabase,
  ownedMediaJob,
} from "./ledger";
import type { MediaEnv } from "./policy";
import { maintainProbeRetention, probeRecoveryWitness } from "./probe-permit";
import { getMediaJob, mediaMetadata } from "./service";

export async function eraseMediaBody(
  env: MediaEnv,
  identity: Identity,
  id: string,
) {
  await ownedMediaJob(env.DB, identity.id, id);
  const now = Date.now();
  await mediaDatabase(
    env.DB.batch([
      env.DB.prepare(
        `UPDATE media_jobs SET body_erased_at=COALESCE(body_erased_at,?),cancel_requested_at=CASE WHEN terminal_at IS NULL THEN COALESCE(cancel_requested_at,?) ELSE cancel_requested_at END,updated_at=? WHERE id=? AND owner_id=?`,
      ).bind(now, now, now, id, identity.id),
      env.DB.prepare(
        "DELETE FROM media_job_bodies WHERE job_id=? AND owner_id=?",
      ).bind(id, identity.id),
      env.DB.prepare(
        "DELETE FROM media_job_assets WHERE job_id=? AND owner_id=? AND role!='output'",
      ).bind(id, identity.id),
      env.DB.prepare(
        "UPDATE media_asset_grants SET revoked_at=COALESCE(revoked_at,?) WHERE job_id=? AND owner_id=?",
      ).bind(now, id, identity.id),
    ]),
  );
  return getMediaJob(env, identity, id);
}
/** M-2の物理削除adapter用。実R2/APIは追加せず、fakeで確認する内部境界。 */
export async function confirmMediaAssetDeletion(
  db: D1Database,
  owner: string,
  id: string,
  verifyPhysicalDeletion: (asset: Readonly<MediaAsset>) => Promise<boolean>,
) {
  const asset = await mediaDatabase(
    db
      .prepare("SELECT * FROM media_assets WHERE id=? AND owner_id=?")
      .bind(id, owner)
      .first<MediaAsset>(),
  );
  if (!asset) throw new ApiError(404, "not_found");
  if (asset.state === "deleted") return { isDeleted: true };
  await mediaDatabase(
    db.batch([
      db
        .prepare(
          "UPDATE media_jobs SET cancel_requested_at=COALESCE(cancel_requested_at,?),updated_at=? WHERE owner_id=? AND terminal_at IS NULL AND id IN(SELECT job_id FROM media_job_assets WHERE asset_id=? AND owner_id=?)",
        )
        .bind(Date.now(), Date.now(), owner, id, owner),
      db
        .prepare(
          "UPDATE media_assets SET state='deleting' WHERE id=? AND owner_id=? AND state!='deleted'",
        )
        .bind(id, owner),
      db
        .prepare(
          "UPDATE media_storage_reservations SET state='deleting' WHERE job_id=? AND owner_id=? AND state='stored'",
        )
        .bind(asset.source_job_id, owner),
    ]),
  );
  if (!(await verifyPhysicalDeletion(asset)))
    throw new ApiError(502, "media_delete_pending");
  const now = Date.now();
  await mediaDatabase(
    db.batch([
      db
        .prepare(
          "UPDATE media_assets SET state='deleted',deleted_at=? WHERE id=? AND owner_id=? AND version=? AND state='deleting'",
        )
        .bind(now, id, owner, asset.version),
      // changes()は同じbatchの直前のasset CAS。並行確認で二重解放しない。
      db
        .prepare(
          "UPDATE media_storage_reservations SET held_bytes=max(0,held_bytes-?),state=CASE WHEN held_bytes<=? THEN 'released' ELSE 'deleting' END WHERE job_id=? AND owner_id=? AND state IN ('stored','deleting') AND changes()=1",
        )
        .bind(asset.bytes, asset.bytes, asset.source_job_id, owner),
    ]),
  );
  const confirmed = await mediaDatabase(
    db
      .prepare("SELECT state FROM media_assets WHERE id=? AND owner_id=?")
      .bind(id, owner)
      .first<{ state: string }>(),
  );
  if (confirmed?.state !== "deleted")
    throw new ApiError(503, "media_deletion_conflict");
  return { isDeleted: true };
}
/** bounded maintenance。本文期限と台帳期限を分け、未終端は削除しない。 */
export async function maintainMediaRetention(db: D1Database, now = Date.now()) {
  await expireMediaSubmissions(db, now);
  await mediaDatabase(
    db.batch([
      db
        .prepare(
          `UPDATE media_jobs SET body_erased_at=? WHERE id IN(SELECT id FROM media_jobs WHERE body_erased_at IS NULL AND terminal_at IS NOT NULL AND terminal_at<=? ORDER BY terminal_at LIMIT 100)`,
        )
        .bind(now, now - MEDIA_LIMITS.bodyRetentionMs),
      db.prepare(
        "DELETE FROM media_job_bodies WHERE job_id IN(SELECT b.job_id FROM media_job_bodies b JOIN media_jobs j ON j.id=b.job_id WHERE j.body_erased_at IS NOT NULL ORDER BY j.body_erased_at LIMIT 100)",
      ),
      db.prepare(
        "DELETE FROM media_job_assets WHERE (job_id,role,ordinal) IN(SELECT l.job_id,l.role,l.ordinal FROM media_job_assets l JOIN media_jobs j ON j.id=l.job_id WHERE l.role!='output' AND j.body_erased_at IS NOT NULL ORDER BY j.body_erased_at LIMIT 100)",
      ),
      db
        .prepare(
          `DELETE FROM media_jobs WHERE id IN(SELECT id FROM media_jobs WHERE terminal_at IS NOT NULL AND terminal_at<=? AND body_erased_at IS NOT NULL ORDER BY terminal_at LIMIT 100)`,
        )
        .bind(now - MEDIA_LIMITS.ledgerRetentionMs),
      db.prepare(
        "DELETE FROM media_storage_reservations WHERE job_id IN(SELECT r.job_id FROM media_storage_reservations r WHERE r.state='released' AND NOT EXISTS(SELECT 1 FROM media_jobs j WHERE j.id=r.job_id) LIMIT 100)",
      ),
    ]),
  );
  await maintainProbeRetention(db, now);
}

// 稼働DB外の正しい最小台帳/削除記録との照合を要求する内部境界。
// 本文・URL・tokenのsnapshot/exportを自動追加しない。外部送信APIにも公開しない。
interface RecoveryJob {
  id: string;
  owner_id: string;
  request_key: string;
  input_hash: string;
  model_id: string;
  quantity: number;
  reserved_bytes: number;
  created_at: number;
  attempt_count: number;
  provider_state: string;
  provider_id: string | null;
  terminal_at: number | null;
  terminal_outcome: string | null;
  body_erased_at: number | null;
  cancel_requested_at: number | null;
}
interface RecoveryAsset {
  id: string;
  owner_id: string;
  bytes: number;
  state: string;
  version: number;
  validated_at: number;
  expires_at: number;
  deleted_at: number | null;
}
interface RecoveryUsage {
  job_id: string;
  owner_id: string;
  kind: string;
  quantity: number;
  consumed_at: number;
}
interface RecoveryStorage {
  job_id: string;
  owner_id: string;
  held_bytes: number;
  state: string;
}
interface RecoveryLegacy {
  id: string;
  owner_id: string;
  request_key: string;
  state: string;
  created_at: number;
}
export interface MediaRecoveryWitness {
  jobs: RecoveryJob[];
  assets: RecoveryAsset[];
  usage: RecoveryUsage[];
  storage: RecoveryStorage[];
  legacy: RecoveryLegacy[];
  uploads: unknown[];
  outputObjects: unknown[];
  probe?: unknown[][];
}
const RECOVERY_JOB_COLUMNS =
  "id,owner_id,request_key,input_hash,model_id,quantity,reserved_bytes,created_at,attempt_count,provider_state,provider_id,terminal_at,terminal_outcome,body_erased_at,cancel_requested_at";
export async function blockMediaRecovery(db: D1Database) {
  await mediaDatabase(
    db
      .prepare(
        "UPDATE media_runtime_state SET is_recovery_blocked=1 WHERE id=1",
      )
      .run(),
  );
}
export async function readMediaRecoveryWitness(
  db: D1Database,
): Promise<MediaRecoveryWitness> {
  // 一貫した読取りはbatch内。必ず全書込み/外部送信を停止してから取得する。
  const results = await mediaDatabase(
    db.batch([
      db.prepare(
        `SELECT ${RECOVERY_JOB_COLUMNS} FROM media_jobs ORDER BY id LIMIT 1001`,
      ),
      db.prepare(
        "SELECT id,owner_id,bytes,state,version,validated_at,expires_at,deleted_at FROM media_assets ORDER BY id LIMIT 1001",
      ),
      db.prepare("SELECT * FROM media_usage_events ORDER BY job_id LIMIT 1001"),
      db.prepare(
        "SELECT * FROM media_storage_reservations ORDER BY job_id LIMIT 1001",
      ),
      db.prepare(
        "SELECT id,owner_id,request_key,state,created_at FROM image_jobs ORDER BY id LIMIT 1001",
      ),
      db.prepare(
        "SELECT asset_id,owner_id,declared_bytes,state,expires_at FROM media_uploads ORDER BY asset_id LIMIT 1001",
      ),
      db.prepare(
        "SELECT job_id,owner_id,ordinal,asset_id,state,created_at FROM media_output_objects ORDER BY job_id,ordinal LIMIT 1001",
      ),
    ]),
  );
  if (results.some((result) => result.results.length > 1000))
    throw new ApiError(503, "media_recovery_manual_reconciliation_required");
  return {
    jobs: results[0].results as unknown as RecoveryJob[],
    assets: results[1].results as unknown as RecoveryAsset[],
    usage: results[2].results as unknown as RecoveryUsage[],
    storage: results[3].results as unknown as RecoveryStorage[],
    legacy: results[4].results as unknown as RecoveryLegacy[],
    uploads: results[5].results,
    outputObjects: results[6].results,
    probe: await probeRecoveryWitness(db),
  };
}
function sameRecords(left: unknown[], right: unknown[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}
export async function reconcileMediaRecovery(
  db: D1Database,
  witness: MediaRecoveryWitness | undefined,
  verifyExternalReconciliation: () => Promise<boolean>,
  now = Date.now(),
) {
  // 復元したDB自身のgateも巻き戻るため、復元後も最初に閉じ直す。
  await blockMediaRecovery(db);
  if (!witness) throw new ApiError(503, "media_recovery_witness_required");
  const current = await readMediaRecoveryWitness(db);
  const immutable = ({
    body_erased_at: _body,
    cancel_requested_at: _cancel,
    ...row
  }: RecoveryJob) => row;
  if (
    !sameRecords(current.jobs.map(immutable), witness.jobs.map(immutable)) ||
    !sameRecords(current.usage, witness.usage) ||
    !sameRecords(current.storage, witness.storage) ||
    !sameRecords(current.legacy, witness.legacy) ||
    !sameRecords(current.assets, witness.assets) ||
    !sameRecords(current.uploads, witness.uploads) ||
    !sameRecords(current.outputObjects, witness.outputObjects) ||
    JSON.stringify(current.probe) !== JSON.stringify(witness.probe)
  )
    throw new ApiError(503, "media_recovery_manual_reconciliation_required");
  // 巻戻った本文の早期消去と取消意図だけを単調に再適用する。
  const statements = witness.jobs.flatMap((job) => {
    const items: D1PreparedStatement[] = [];
    if (job.body_erased_at !== null)
      items.push(
        db
          .prepare(
            "UPDATE media_jobs SET body_erased_at=COALESCE(body_erased_at,?) WHERE id=? AND owner_id=?",
          )
          .bind(job.body_erased_at, job.id, job.owner_id),
        db
          .prepare("DELETE FROM media_job_bodies WHERE job_id=? AND owner_id=?")
          .bind(job.id, job.owner_id),
        db
          .prepare(
            "DELETE FROM media_job_assets WHERE job_id=? AND owner_id=? AND role!='output'",
          )
          .bind(job.id, job.owner_id),
      );
    if (job.cancel_requested_at !== null)
      items.push(
        db
          .prepare(
            "UPDATE media_jobs SET cancel_requested_at=COALESCE(cancel_requested_at,?) WHERE id=? AND owner_id=?",
          )
          .bind(job.cancel_requested_at, job.id, job.owner_id),
      );
    return items;
  });
  // bounded API。大きな復旧は別の明示的な管理手順で照合し、自動解除しない。
  if (statements.length > 100)
    throw new ApiError(503, "media_recovery_manual_reconciliation_required");
  if (statements.length) await mediaDatabase(db.batch(statements));
  await mediaDatabase(
    db
      .prepare(
        "UPDATE media_asset_grants SET revoked_at=COALESCE(revoked_at,?)",
      )
      .bind(now)
      .run(),
  );
  await maintainMediaRetention(db, now);
  if (!(await verifyExternalReconciliation()))
    throw new ApiError(503, "media_recovery_external_reconciliation_required");
  // 未確定/予約/回収中があれば自動再開を拒否。unknownを消して解除しない。
  const active = await mediaDatabase(
    db
      .prepare("SELECT count(*) AS n FROM media_active_jobs")
      .first<{ n: number }>(),
  );
  if (active?.n !== 0)
    throw new ApiError(503, "media_recovery_unresolved_jobs");
  const unresolvedAssets = await mediaDatabase(
    db
      .prepare(
        "SELECT (SELECT count(*) FROM media_uploads WHERE state!='settled')+(SELECT count(*) FROM media_output_objects WHERE state IN ('writing','write_unknown','deleting')) AS n",
      )
      .first<{ n: number }>(),
  );
  if (unresolvedAssets?.n !== 0)
    throw new ApiError(503, "media_recovery_unresolved_assets");
  await mediaDatabase(
    db
      .prepare(
        "UPDATE media_runtime_state SET is_recovery_blocked=0 WHERE id=1 AND NOT EXISTS(SELECT 1 FROM media_active_jobs)",
      )
      .run(),
  );
  return { isReconciled: true };
}

/** 対応する上流要求が確認できたときだけ内部adapterが呼ぶ。利用者向け強制解放APIはない。 */
export async function resolveUnknownMediaSubmission(
  db: D1Database,
  owner: string,
  id: string,
  verify: (
    job: Readonly<MediaJob>,
  ) => Promise<
    { outcome: "accepted"; requestId: string } | { outcome: "rejected" } | null
  >,
) {
  await ownedMediaJob(db, owner, id);
  const token = crypto.randomUUID();
  const now = Date.now();
  const claim = await mediaDatabase(
    db
      .prepare(
        "UPDATE media_jobs SET lease_token=?,lease_until=? WHERE id=? AND owner_id=? AND provider_state='submission_unknown' AND terminal_at IS NULL AND (lease_until IS NULL OR lease_until<=?)",
      )
      .bind(token, now + MEDIA_LIMITS.leaseMs, id, owner, now)
      .run(),
  );
  if (claim.meta.changes !== 1)
    throw new ApiError(409, "media_resolution_not_claimed");
  try {
    const job = await ownedMediaJob(db, owner, id);
    const proof = await verify(job);
    if (!proof) throw new ApiError(409, "media_submission_still_unknown");
    const finishedAt = Date.now();
    const isAccepted = proof.outcome === "accepted";
    if (isAccepted && !/^[A-Za-z0-9_-]{1,100}$/.test(proof.requestId))
      throw new ApiError(400, "media_resolution_invalid");
    const results = await mediaDatabase(
      db.batch([
        db
          .prepare(
            `UPDATE media_jobs SET provider_id=?,provider_state=?,collection_state=CASE WHEN ? THEN 'pending' ELSE 'discarded' END,terminal_at=?,terminal_outcome=?,updated_at=? WHERE id=? AND owner_id=? AND provider_state='submission_unknown' AND terminal_at IS NULL AND lease_token=? AND lease_until>?`,
          )
          .bind(
            isAccepted ? proof.requestId : null,
            isAccepted ? "queued" : "failed",
            isAccepted ? 1 : 0,
            isAccepted ? null : finishedAt,
            isAccepted ? null : "failed",
            finishedAt,
            id,
            owner,
            token,
            finishedAt,
          ),
        db
          .prepare(
            "UPDATE media_storage_reservations SET held_bytes=0,state='released' WHERE job_id=? AND EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND terminal_at=? AND terminal_outcome='failed')",
          )
          .bind(id, id, finishedAt),
      ]),
    );
    if (results[0].meta.changes !== 1)
      throw new ApiError(503, "media_lease_lost");
  } finally {
    await mediaDatabase(
      db
        .prepare(
          "UPDATE media_jobs SET lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND lease_token=?",
        )
        .bind(id, owner, token)
        .run(),
    );
  }
  return mediaMetadata(await ownedMediaJob(db, owner, id));
}
