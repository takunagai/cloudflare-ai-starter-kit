import { z } from "zod";
import { decideNote } from "./agent-tools";
import { listModels } from "./ai/providers";
import {
  chatModelAllowed,
  checkChatRuntimePolicy,
  checkExtensionRuntimePolicy,
  requireExtensionEnabled,
  type VerificationEnv,
  verificationStatus,
} from "./ai-verification";
import { getIdentity, handleAuth } from "./auth";
import { handleBilling } from "./billing";
import { handleChat } from "./chat";
import { ownedConversation, rateLimit } from "./chat-store";
import { isEnabled, isLocalDevelopment } from "./env";
import { handleExtensions } from "./extensions/routes";
import {
  ApiError,
  errorResponse,
  guardRequestEnvironment,
  json,
  readJson,
  requireSameOrigin,
} from "./http";
import { resolveRuntimePolicy } from "./runtime-policy";

function method(request: Request, allowed: string[]) {
  if (!allowed.includes(request.method))
    throw new ApiError(405, "method_not_allowed");
}

export async function handleApp(
  request: Request,
  env: VerificationEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    guardRequestEnvironment(request, env);
    const extensionsBlocked =
      env.APP_ENV === "staging" &&
      (env.STAGING_POLICY === undefined ||
        env.STAGING_POLICY === "verification");
    if (
      extensionsBlocked &&
      (path.startsWith("/api/billing/") ||
        path.startsWith("/api/extensions/") ||
        path === "/api/approvals" ||
        path.startsWith("/api/approvals/") ||
        path === "/api/notes")
    )
      throw new ApiError(404, "feature_disabled");
    // OFFは認証前に404。ONのmethod/input/所有権は各handlerで先に確認。
    if (path.startsWith("/api/billing/"))
      requireExtensionEnabled(env, env.ENABLE_BILLING);
    const feature = /^\/api\/extensions\/(rag|images|workflows)(?:\/|$)/.exec(
      path,
    )?.[1];
    if (feature)
      requireExtensionEnabled(
        env,
        feature === "rag"
          ? env.ENABLE_RAG
          : feature === "images"
            ? env.ENABLE_IMAGES
            : env.ENABLE_WORKFLOWS,
      );
    if (
      path === "/api/notes" ||
      path === "/api/approvals" ||
      path.startsWith("/api/approvals/")
    )
      requireExtensionEnabled(env, env.ENABLE_AGENT);
    if (path === "/api/billing/webhook")
      return (
        (await handleBilling(request, env, null)) ??
        json({ error: "not_found" }, 404)
      );
    if (path.startsWith("/api/auth/")) return await handleAuth(request, env);
    requireSameOrigin(request);
    const identity = await getIdentity(request, env);
    if (path === "/api/session") {
      method(request, ["GET"]);
      const policy = resolveRuntimePolicy(env);
      const featuresAvailable = !extensionsBlocked && policy.boundary.ok;
      const chatAvailable = featuresAvailable && policy.chat.ok;
      return json({
        identity,
        authMode: env.AUTH_MODE,
        googleEnabled: Boolean(
          env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
        ),
        localDemo: isLocalDevelopment(env) && env.LOCAL_DEMO === "true",
        features: {
          rag: featuresAvailable && isEnabled(env.ENABLE_RAG),
          agent: chatAvailable && isEnabled(env.ENABLE_AGENT),
          workflows: chatAvailable && isEnabled(env.ENABLE_WORKFLOWS),
          images: featuresAvailable && isEnabled(env.ENABLE_IMAGES),
          billing: featuresAvailable && isEnabled(env.ENABLE_BILLING),
        },
      });
    }
    if (!identity) throw new ApiError(401, "authentication_required");
    await rateLimit(env, identity.id, "api", 120);
    if (path === "/api/ai-verification") {
      method(request, ["GET"]);
      return json(await verificationStatus(env, identity.id));
    }
    const billing = await handleBilling(request, env, identity);
    if (billing) return billing;
    if (path === "/api/models") {
      method(request, ["GET"]);
      let models = listModels(env);
      try {
        const policy = await checkChatRuntimePolicy(env);
        models = models.map((model) => ({
          ...model,
          available: model.available && chatModelAllowed(policy, model.id),
        }));
      } catch {
        models = models.map((model) => ({ ...model, available: false }));
      }
      return json({ models });
    }
    if (path === "/api/conversations") {
      method(request, ["GET", "POST"]);
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
    if (conversation) {
      method(request, ["GET", "DELETE"]);
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
    if (path === "/api/chat") {
      method(request, ["POST"]);
      return await handleChat(request, env, identity, ctx);
    }
    if (
      ["/api/approvals", "/api/notes"].includes(path) ||
      path.startsWith("/api/approvals/")
    ) {
      if (!isEnabled(env.ENABLE_AGENT))
        throw new ApiError(404, "feature_disabled");
      if (path === "/api/notes") {
        method(request, ["GET"]);
        await checkExtensionRuntimePolicy(env);
        const { results } = await env.DB.prepare(
          "SELECT id,title,content,created_at FROM notes WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",
        )
          .bind(identity.id)
          .all();
        return json({ notes: results });
      }
      if (path === "/api/approvals") {
        method(request, ["GET"]);
        await checkExtensionRuntimePolicy(env);
        const { results } = await env.DB.prepare(
          "SELECT id,title,content,status,expires_at FROM tool_approvals WHERE owner_id=? AND status='pending' AND expires_at>=? ORDER BY created_at DESC LIMIT 100",
        )
          .bind(identity.id, Date.now())
          .all();
        return json({ approvals: results });
      }
      const match = /^\/api\/approvals\/([a-f0-9-]{36})$/.exec(path);
      if (match) {
        method(request, ["POST"]);
        const { decision } = await readJson(
          request,
          z.object({ decision: z.enum(["approve", "reject"]) }).strict(),
        );
        return json(await decideNote(env, identity, match[1], decision));
      }
    }
    const extension = await handleExtensions(request, env, identity);
    if (extension) return extension;
    return json({ error: "not_found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
