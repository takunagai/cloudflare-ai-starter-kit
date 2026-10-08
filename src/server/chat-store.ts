import type { RequestReceipt } from "../lib/reliability";
import {
  chatModelAllowed,
  checkChatRuntimePolicy,
  checkVerificationInput,
  type VerificationEnv,
  verificationModelId,
  verificationSettings,
} from "./ai-verification";
import type { AppEnv, Identity } from "./env";
import { ApiError } from "./http";

export async function rateLimit(
  env: AppEnv,
  owner: string,
  scope: string,
  limit = 60,
) {
  const minute = Math.floor(Date.now() / 60000);
  await env.DB.prepare("DELETE FROM app_rate_limits WHERE expires_at<?")
    .bind(Date.now())
    .run();
  const row =
    await env.DB.prepare(`INSERT INTO app_rate_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`)
      .bind(`${scope}:${owner}:${minute}`, (minute + 2) * 60000)
      .first<{ count: number }>();
  if (!row || row.count > limit) throw new ApiError(429, "rate_limit_exceeded");
}

export async function ownedConversation(
  env: AppEnv,
  owner: string,
  id: string,
) {
  const row = await env.DB.prepare(
    "SELECT id,title,created_at,updated_at,active_request_id,lock_until FROM conversations WHERE id=? AND owner_id=?",
  )
    .bind(id, owner)
    .first<{
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
      active_request_id: string | null;
      lock_until: number | null;
    }>();
  if (!row) throw new ApiError(404, "conversation_not_found");
  return row;
}

export interface ChatInput {
  conversationId: string;
  requestId: string;
  modelId: string;
  message: string;
  rag: boolean;
  agent: boolean;
}

export async function reserveChat(
  env: VerificationEnv,
  identity: Identity,
  input: ChatInput,
) {
  const legacy =
    env.APP_ENV === "staging" &&
    (env.STAGING_POLICY === undefined || env.STAGING_POLICY === "verification");
  if (!legacy) {
    await ownedConversation(env, identity.id, input.conversationId);
    const policy = await checkChatRuntimePolicy(env);
    if (!chatModelAllowed(policy, input.modelId))
      throw new ApiError(503, "model_unavailable");
  }
  const verification = verificationSettings(env);
  if (verification) {
    if (input.modelId !== verificationModelId || input.rag || input.agent)
      throw new ApiError(400, "verification_model_or_feature");
    checkVerificationInput(input.message, []);
  }
  if (legacy) await ownedConversation(env, identity.id, input.conversationId);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(input)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const old = await env.DB.prepare(
    "SELECT owner_id,input_hash,status FROM chat_requests WHERE id=?",
  )
    .bind(input.requestId)
    .first<{ owner_id: string; input_hash: string; status: string }>();
  if (old) {
    if (old.owner_id !== identity.id || old.input_hash !== hash)
      throw new ApiError(409, "request_id_conflict");
    if (old.status === "complete") return false;
    throw new ApiError(
      409,
      old.status === "pending" ? "request_in_progress" : "request_already_used",
    );
  }
  const now = Date.now();
  const day = Math.floor(now / 86400000) * 86400000;
  // Each D1 batch is transactional. Admission, daily quota and the user-wide
  // concurrency check are evaluated inside the same serialized transaction.
  try {
    await env.DB.batch([
      ...(verification
        ? [
            env.DB.prepare(
              "INSERT OR IGNORE INTO ai_verification(id,owner_id,started_at,expires_at,attempts) VALUES (1,?,?,?,0)",
            ).bind(identity.id, verification.startedAt, verification.expiresAt),
          ]
        : []),
      env.DB.prepare(
        "UPDATE messages SET status='failed' WHERE status='pending' AND request_id IN (SELECT id FROM chat_requests WHERE owner_id=? AND status='pending' AND created_at<?)",
      ).bind(identity.id, now - 120000),
      env.DB.prepare(
        "UPDATE chat_requests SET status='failed',finished_at=? WHERE owner_id=? AND status='pending' AND created_at<?",
      ).bind(now, identity.id, now - 120000),
      env.DB.prepare(`UPDATE conversations SET active_request_id=?,lock_until=? WHERE id=? AND owner_id=?
      AND (active_request_id IS NULL OR lock_until<?)
      AND NOT EXISTS(SELECT 1 FROM chat_requests WHERE owner_id=? AND status='pending')
      AND (SELECT count(*) FROM chat_requests WHERE owner_id=? AND created_at>=?)<60
      ${
        verification
          ? `AND created_at>=? AND EXISTS(
        SELECT 1 FROM ai_verification WHERE id=1 AND owner_id=? AND started_at=? AND expires_at=? AND attempts<3
        AND ? >= started_at AND ? < expires_at)
        AND NOT EXISTS(SELECT 1 FROM chat_requests WHERE status='pending')`
          : ""
      }`).bind(
        input.requestId,
        now + 120000,
        input.conversationId,
        identity.id,
        now,
        identity.id,
        identity.id,
        day,
        ...(verification
          ? [
              verification.startedAt,
              identity.id,
              verification.startedAt,
              verification.expiresAt,
              now,
              now,
            ]
          : []),
      ),
      env.DB.prepare(`INSERT INTO chat_requests(id,owner_id,conversation_id,model_id,input_hash,status,created_at,inference_started)
      SELECT ?,?,?,?,?, 'pending',?,0 WHERE EXISTS(SELECT 1 FROM conversations WHERE id=? AND owner_id=? AND active_request_id=?)`).bind(
        input.requestId,
        identity.id,
        input.conversationId,
        input.modelId,
        hash,
        now,
        input.conversationId,
        identity.id,
        input.requestId,
      ),
      ...(verification
        ? [
            env.DB.prepare(
              "UPDATE ai_verification SET attempts=attempts+1 WHERE id=1 AND EXISTS(SELECT 1 FROM chat_requests WHERE id=? AND owner_id=? AND status='pending')",
            ).bind(input.requestId, identity.id),
          ]
        : []),
      env.DB.prepare(`INSERT INTO messages(id,conversation_id,request_id,role,content,status,created_at)
      SELECT ?,?,?,'user',?,'pending',? WHERE EXISTS(SELECT 1 FROM chat_requests WHERE id=? AND status='pending')`).bind(
        crypto.randomUUID(),
        input.conversationId,
        input.requestId,
        input.message,
        now,
        input.requestId,
      ),
      env.DB.prepare(`INSERT INTO messages(id,conversation_id,request_id,role,content,status,created_at)
      SELECT ?,?,?,'assistant','','pending',? WHERE EXISTS(SELECT 1 FROM chat_requests WHERE id=? AND status='pending')`).bind(
        crypto.randomUUID(),
        input.conversationId,
        input.requestId,
        now + 1,
        input.requestId,
      ),
    ]);
  } catch (error) {
    const duplicate = await env.DB.prepare(
      "SELECT owner_id,input_hash FROM chat_requests WHERE id=?",
    )
      .bind(input.requestId)
      .first<{ owner_id: string; input_hash: string }>();
    if (duplicate)
      throw new ApiError(
        409,
        duplicate.owner_id === identity.id && duplicate.input_hash === hash
          ? "request_in_progress"
          : "request_id_conflict",
      );
    throw error;
  }
  const accepted = await env.DB.prepare(
    "SELECT id FROM chat_requests WHERE id=? AND owner_id=?",
  )
    .bind(input.requestId, identity.id)
    .first();
  if (!accepted) throw new ApiError(429, "quota_or_concurrency_limit");
  return true;
}

export async function finishChat(
  env: AppEnv,
  identity: Identity,
  input: ChatInput,
  content: string,
  status: "complete" | "failed" | "cancelled",
  sources: unknown[] = [],
  failureCode: string | null = null,
) {
  const now = Date.now();
  const saved = await env.DB.batch([
    env.DB.prepare(
      "UPDATE messages SET content=?,status=?,sources_json=? WHERE request_id=? AND role='assistant' AND status='pending'",
    ).bind(content, status, JSON.stringify(sources), input.requestId),
    env.DB.prepare(
      "UPDATE messages SET status=? WHERE request_id=? AND role='user' AND status='pending'",
    ).bind(status, input.requestId),
    env.DB.prepare(
      "UPDATE chat_requests SET status=?,finished_at=?,failure_code=? WHERE id=? AND owner_id=? AND status='pending'",
    ).bind(status, now, failureCode, input.requestId, identity.id),
    env.DB.prepare(
      "UPDATE conversations SET active_request_id=NULL,lock_until=NULL,updated_at=? WHERE id=? AND owner_id=? AND active_request_id=?",
    ).bind(now, input.conversationId, identity.id, input.requestId),
  ]);
  // 完了なのに台帳が更新されない場合は、完了表示せず保存不明として扱う。
  if (status === "complete" && !saved[2].meta.changes)
    throw new ApiError(409, "history_save_failed");
}

export async function chatRequestStatus(
  env: AppEnv,
  identity: Identity,
  id: string,
): Promise<RequestReceipt> {
  const row = await env.DB.prepare(
    "SELECT id,conversation_id,status,inference_started,failure_code,created_at FROM chat_requests WHERE id=? AND owner_id=?",
  )
    .bind(id, identity.id)
    .first<{
      id: string;
      conversation_id: string | null;
      status: string;
      inference_started: number | null;
      failure_code: string | null;
      created_at: number;
    }>();
  if (!row) throw new ApiError(404, "request_not_found");
  const isStale =
    row.status === "pending" && row.created_at < Date.now() - 120_000;
  return {
    requestId: row.id,
    conversationId: row.conversation_id,
    status: isStale ? "unknown" : row.status,
    failureCode: row.failure_code,
    // 1は推論が始まった可能性で、課金済みの証明ではない。NULLの旧要求は推論なしと推定しない。
    inference:
      row.inference_started === 0
        ? "not_started"
        : row.inference_started === 1
          ? "may_have_run"
          : "unknown",
    canRetry:
      row.status !== "pending" &&
      row.status !== "complete" &&
      row.inference_started === 0,
  };
}

export async function chatHistory(
  env: AppEnv,
  conversationId: string,
  requestId: string,
  strict = false,
) {
  if (strict) {
    const { results } = await env.DB.prepare(
      "SELECT role,content,status,request_id FROM messages WHERE conversation_id=? AND request_id!=? ORDER BY created_at ASC LIMIT 3",
    )
      .bind(conversationId, requestId)
      .all<{
        role: "user" | "assistant";
        content: string;
        status: string;
        request_id: string;
      }>();
    if (
      results.some((row) => row.status !== "complete") ||
      (results.length === 2 && results[0].request_id !== results[1].request_id)
    )
      throw new ApiError(400, "verification_history_limit");
    checkVerificationInput("", results);
    return results.map(({ role, content }) => ({ role, content }));
  }
  const { results } = await env.DB.prepare(
    "SELECT role,content FROM messages WHERE conversation_id=? AND request_id!=? AND status='complete' ORDER BY created_at DESC LIMIT 20",
  )
    .bind(conversationId, requestId)
    .all<{ role: "user" | "assistant"; content: string }>();
  let size = 0;
  return results
    .filter((row) => {
      size += row.content.length;
      return size <= 16000;
    })
    .reverse();
}
