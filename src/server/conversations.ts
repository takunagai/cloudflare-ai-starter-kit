import { z } from "zod";
import { ownedConversation } from "./chat-store";
import type { AppEnv, Identity } from "./env";
import { ApiError, json, readJson, requireMethod } from "./http";

/** 会話の一覧・作成・取得・削除。対象外のpathはnullを返す。 */
export async function handleConversations(
  request: Request,
  env: AppEnv,
  identity: Identity,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/conversations") {
    requireMethod(request, ["GET", "POST"]);
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id,title,updated_at FROM conversations WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100",
      )
        .bind(identity.id)
        .all();
      return json({ conversations: results });
    }
    const { title } = await readJson(
      request,
      z
        .object({
          title: z.string().trim().min(1).max(100).default("新しい会話"),
        })
        .strict(),
    );
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM conversations WHERE owner_id=?)<100",
    )
      .bind(id, identity.id, title, Date.now(), Date.now(), identity.id)
      .run();
    if (!result.meta.changes) throw new ApiError(429, "conversation_limit");
    return json({ conversation: { id, title } }, 201);
  }
  const conversation = /^\/api\/conversations\/([a-f0-9-]{36})$/.exec(path);
  if (!conversation) return null;
  requireMethod(request, ["GET", "DELETE"]);
  const row = await ownedConversation(env, identity.id, conversation[1]);
  if (request.method === "DELETE") {
    const deleted = await env.DB.prepare(
      "DELETE FROM conversations WHERE id=? AND owner_id=? AND (active_request_id IS NULL OR lock_until<?)",
    )
      .bind(row.id, identity.id, Date.now())
      .run();
    if (!deleted.meta.changes) throw new ApiError(409, "conversation_busy");
    return json({ deleted: true });
  }
  const { results } = await env.DB.prepare(
    "SELECT * FROM (SELECT id,role,content,status,created_at,sources_json FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 1000) ORDER BY created_at ASC",
  )
    .bind(row.id)
    .all();
  return json({
    conversation: { id: row.id, title: row.title },
    messages: results.map(({ sources_json, ...message }) => ({
      ...message,
      sources: JSON.parse(String(sources_json)),
    })),
  });
}
