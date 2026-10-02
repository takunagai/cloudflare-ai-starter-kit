import { ApiError } from "../http";
import { type DecisionDefinition, decisionLimits as limits } from "./contracts";

export type DecisionState =
  | "reserved"
  | "submitting"
  | "succeeded"
  | "failed"
  | "submission_unknown";
export type DecisionRow = {
  state: DecisionState;
  error_code: string | null;
  attempt_count: number;
  created_at: number;
  reservation_until: number;
  sent_at: number | null;
  execution_until: number | null;
  finished_at: number | null;
  expires_at: number | null;
};
const columns =
  "state,error_code,attempt_count,created_at,reservation_until,sent_at,execution_until,finished_at,expires_at";
export async function ledgerCall<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch {
    throw new ApiError(503, "decision_ledger_unavailable");
  }
}
export function getDecisionRow(db: D1Database, owner: string, key: string) {
  return ledgerCall(
    db
      .prepare(
        `SELECT ${columns} FROM decision_requests WHERE owner_id=? AND request_key=?`,
      )
      .bind(owner, key)
      .first<DecisionRow>(),
  );
}
export function visibleState(row: DecisionRow, now: number): DecisionState {
  if (row.state === "reserved" && row.reservation_until <= now) return "failed";
  if (row.state === "submitting" && (row.execution_until ?? 0) <= now)
    return "submission_unknown";
  return row.state;
}
export function duplicateError(row: DecisionRow, now: number): never {
  const state = visibleState(row, now);
  throw new ApiError(
    409,
    state === "submission_unknown"
      ? "decision_submission_unknown"
      : state === "reserved" || state === "submitting"
        ? "decision_in_progress"
        : "decision_already_used",
  );
}
export async function reserveDecision(
  db: D1Database,
  owner: string,
  key: string,
  definition: DecisionDefinition,
  now: number,
) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (key.slice(0, 10) !== day) throw new ApiError(400, "request_day_mismatch");
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  const result = await ledgerCall(
    db.batch([
      db
        .prepare(`UPDATE decision_requests SET
      state=CASE WHEN state='reserved' THEN 'failed' ELSE 'submission_unknown' END,
      error_code=CASE WHEN state='reserved' THEN 'decision_reservation_expired' ELSE 'decision_submission_unknown' END,
      finished_at=CASE WHEN state='reserved' THEN ? ELSE NULL END,
      expires_at=CASE WHEN state='reserved' THEN ? ELSE NULL END
      WHERE (owner_id,request_key) IN (SELECT owner_id,request_key FROM decision_requests
        WHERE (state='reserved' AND reservation_until<=?) OR (state='submitting' AND execution_until<=?)
        ORDER BY created_at LIMIT 100)`)
        .bind(now, now + limits.retentionMs, now, now),
      db
        .prepare(`DELETE FROM decision_requests WHERE (owner_id,request_key) IN
      (SELECT owner_id,request_key FROM decision_requests WHERE state IN ('succeeded','failed') AND expires_at<=? ORDER BY expires_at LIMIT 100)`)
        .bind(now),
      db
        .prepare(`INSERT INTO decision_requests(owner_id,request_key,request_day,definition_id,contract_version,model_id,question_count,state,created_at,reservation_until)
      SELECT ?,?,?,?,?,?,?,'reserved',?,?
      WHERE NOT EXISTS (SELECT 1 FROM decision_requests WHERE owner_id=? AND request_key=?)
      AND NOT EXISTS (SELECT 1 FROM decision_requests WHERE (state='reserved' AND reservation_until<=?) OR (state='submitting' AND execution_until<=?))
      AND (SELECT count(*) FROM decision_requests WHERE owner_id=? AND created_at>=? AND created_at<?)<?
      AND (SELECT count(*) FROM decision_requests WHERE created_at>=? AND created_at<?)<?
      AND (SELECT count(*) FROM decision_requests WHERE owner_id=? AND created_at>?)<?
      AND (SELECT count(*) FROM decision_requests WHERE owner_id=? AND state IN ('reserved','submitting','submission_unknown'))<?
      AND (SELECT count(*) FROM decision_requests WHERE state IN ('reserved','submitting','submission_unknown'))<?
      ON CONFLICT(owner_id,request_key) DO NOTHING`)
        .bind(
          owner,
          key,
          day,
          definition.id,
          definition.version,
          "jev-1.13.0",
          Object.keys(definition.questions).length,
          now,
          now + limits.leaseMs,
          owner,
          key,
          now,
          now,
          owner,
          dayStart,
          dayStart + 86400000,
          limits.ownerDay,
          dayStart,
          dayStart + 86400000,
          limits.environmentDay,
          owner,
          now - 60000,
          limits.ownerMinute,
          owner,
          limits.ownerConcurrent,
          limits.environmentConcurrent,
        ),
    ]),
  );
  if (result[2].meta.changes === 1) return;
  const row = await getDecisionRow(db, owner, key);
  if (row) duplicateError(row, now);
  throw new ApiError(429, "decision_limit_exceeded");
}
export async function claimDecision(
  db: D1Database,
  owner: string,
  key: string,
  now: number,
) {
  const result = await ledgerCall(
    db
      .prepare(`UPDATE decision_requests SET state='submitting',attempt_count=1,sent_at=?,execution_until=?
    WHERE owner_id=? AND request_key=? AND state='reserved' AND attempt_count=0 AND reservation_until>?`)
      .bind(now, now + limits.leaseMs, owner, key, now)
      .run(),
  );
  if (result.meta.changes !== 1)
    throw new ApiError(503, "decision_ledger_unavailable");
}
export async function finishDecision(
  db: D1Database,
  owner: string,
  key: string,
  expected: "reserved" | "submitting",
  state: "succeeded" | "failed" | "submission_unknown",
  error: string | null,
  now: number,
  usage?: { inputTokens: number; outputTokens: number },
) {
  const terminal = state !== "submission_unknown";
  const result = await ledgerCall(
    db
      .prepare(`UPDATE decision_requests SET state=?,error_code=?,finished_at=?,expires_at=?,input_tokens=?,output_tokens=?
    WHERE owner_id=? AND request_key=? AND state=? AND ${expected === "reserved" ? "reservation_until" : "execution_until"}>?`)
      .bind(
        state,
        error,
        terminal ? now : null,
        terminal ? now + limits.retentionMs : null,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        owner,
        key,
        expected,
        now,
      )
      .run(),
  );
  if (result.meta.changes !== 1)
    throw new ApiError(503, "decision_ledger_unavailable");
}
