import { z } from "zod";
import { decideNote } from "./agent-tools";
import type { Identity } from "./env";
import { json, readJson, requireMethod } from "./http";
import { checkExtensionRuntimePolicy, type RuntimeEnv } from "./runtime-guards";

/** エージェント拡張のメモ一覧・承認待ち一覧・承認判断。ENABLE_AGENTの確認は呼出し元の入口で行う。 */
export async function handleAgentRoutes(
  request: Request,
  env: RuntimeEnv,
  identity: Identity,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/notes") {
    requireMethod(request, ["GET"]);
    await checkExtensionRuntimePolicy(env);
    const { results } = await env.DB.prepare(
      "SELECT id,title,content,created_at FROM notes WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(identity.id)
      .all();
    return json({ notes: results });
  }
  if (path === "/api/approvals") {
    requireMethod(request, ["GET"]);
    await checkExtensionRuntimePolicy(env);
    const { results } = await env.DB.prepare(
      "SELECT id,title,content,status,expires_at FROM tool_approvals WHERE owner_id=? AND status='pending' AND expires_at>=? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(identity.id, Date.now())
      .all();
    return json({ approvals: results });
  }
  const match = /^\/api\/approvals\/([a-f0-9-]{36})$/.exec(path);
  if (!match) return null;
  requireMethod(request, ["POST"]);
  const { decision } = await readJson(
    request,
    z.object({ decision: z.enum(["approve", "reject"]) }).strict(),
  );
  return json(await decideNote(env, identity, match[1], decision));
}
