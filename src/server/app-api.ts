import { handleAgentRoutes } from "./agent-routes";
import { listModels } from "./ai/providers";
import { getIdentity, handleAuth } from "./auth";
import { handleBilling } from "./billing";
import { handleChat } from "./chat";
import { chatRequestStatus, rateLimit } from "./chat-store";
import { handleConversations } from "./conversations";
import { handleDecisions } from "./decisions/routes";
import { isEnabled, isLocalDevelopment } from "./env";
import { handleExtensions } from "./extensions/routes";
import {
  ApiError,
  errorResponse,
  guardRequestEnvironment,
  json,
  requireMethod,
  requireSameOrigin,
} from "./http";
import { handleMediaSource } from "./media/grants";
import { type MediaEnv, requireMediaEnabled } from "./media/policy";
import { handleMedia, isMediaCreationPath } from "./media/routes";
import {
  chatModelAllowed,
  checkChatRuntimePolicy,
  isStagingWithoutStandardPolicy,
  type RuntimeEnv,
  requireExtensionEnabled,
} from "./runtime-guards";
import { resolveRuntimePolicy } from "./runtime-policy";

const exactOrUnder = (base: string) => (path: string) =>
  path === base || path.startsWith(`${base}/`);

/**
 * 任意拡張の入口。標準policyのないstagingでは全行を404で閉じ、flagがある行はOFFでも認証前に404。
 * 上から最初に一致した行だけを使う。mediaはON/OFFを作成系だけで判定するためflagを持たない。
 */
const EXTENSION_GATES: {
  matches: (path: string) => boolean;
  flag?: (env: RuntimeEnv & MediaEnv) => string | undefined;
}[] = [
  {
    matches: (path) => path.startsWith("/api/billing/"),
    flag: (env) => env.ENABLE_BILLING,
  },
  {
    matches: exactOrUnder("/api/extensions/rag"),
    flag: (env) => env.ENABLE_RAG,
  },
  {
    matches: exactOrUnder("/api/extensions/images"),
    flag: (env) => env.ENABLE_IMAGES,
  },
  {
    matches: exactOrUnder("/api/extensions/workflows"),
    flag: (env) => env.ENABLE_WORKFLOWS,
  },
  { matches: (path) => path.startsWith("/api/extensions/") },
  { matches: exactOrUnder("/api/media") },
  { matches: exactOrUnder("/api/media-source") },
  { matches: (path) => path === "/api/notes", flag: (env) => env.ENABLE_AGENT },
  { matches: exactOrUnder("/api/approvals"), flag: (env) => env.ENABLE_AGENT },
];
/** handleAppが受け持つpath。ここにないpathはapi.tsでJSONの404になる。 */
const APP_PATHS: ((path: string) => boolean)[] = [
  (path) => path.startsWith("/api/auth/"),
  (path) => path === "/api/session",
  (path) => path === "/api/models",
  exactOrUnder("/api/conversations"),
  exactOrUnder("/api/chat"),
  exactOrUnder("/api/decisions"),
  ...EXTENSION_GATES.map((entry) => entry.matches),
];
export const isAppPath = (path: string) =>
  APP_PATHS.some((matches) => matches(path));
const isPrivateNoStorePath = (path: string) =>
  exactOrUnder("/api/decisions")(path) ||
  exactOrUnder("/api/media")(path) ||
  exactOrUnder("/api/media-source")(path);

export async function handleApp(
  request: Request,
  env: RuntimeEnv & MediaEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const receivedAt = Date.now();
  try {
    const path = new URL(request.url).pathname;
    guardRequestEnvironment(request, env);
    const extensionsBlocked = isStagingWithoutStandardPolicy(env);
    const gate = EXTENSION_GATES.find((entry) => entry.matches(path));
    if (gate && extensionsBlocked) throw new ApiError(404, "feature_disabled");
    if (exactOrUnder("/api/media-source")(path))
      return await handleMediaSource(request, env);
    if (isMediaCreationPath(path, request.method)) requireMediaEnabled(env);
    // OFFは認証前に404。ONのmethod/input/所有権は各handlerで先に確認。
    if (gate?.flag) requireExtensionEnabled(env, gate.flag(env));
    if (path === "/api/billing/webhook")
      return (
        (await handleBilling(request, env, null)) ??
        json({ error: "not_found" }, 404)
      );
    if (path.startsWith("/api/auth/")) return await handleAuth(request, env);
    if (exactOrUnder("/api/decisions")(path))
      return await handleDecisions(request, env, receivedAt);
    requireSameOrigin(request);
    const identity = await getIdentity(request, env);
    if (path === "/api/session") {
      requireMethod(request, ["GET"]);
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
          media: featuresAvailable && isEnabled(env.ENABLE_MEDIA),
          billing: featuresAvailable && isEnabled(env.ENABLE_BILLING),
        },
      });
    }
    if (!identity) throw new ApiError(401, "authentication_required");
    await rateLimit(env, identity.id, "api", 120);
    if (exactOrUnder("/api/media")(path)) {
      return (
        (await handleMedia(request, env, identity)) ??
        json({ error: "not_found" }, 404, {
          "Cache-Control": "private, no-store",
        })
      );
    }
    const billing = await handleBilling(request, env, identity);
    if (billing) return billing;
    if (path === "/api/models") {
      requireMethod(request, ["GET"]);
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
    const conversation = await handleConversations(request, env, identity);
    if (conversation) return conversation;
    const chatRequest = /^\/api\/chat\/requests\/([a-f0-9-]{36})$/.exec(path);
    if (chatRequest) {
      requireMethod(request, ["GET"]);
      return json(await chatRequestStatus(env, identity, chatRequest[1]));
    }
    if (path === "/api/chat") {
      requireMethod(request, ["POST"]);
      return await handleChat(request, env, identity, ctx);
    }
    if (path === "/api/notes" || exactOrUnder("/api/approvals")(path)) {
      const agent = await handleAgentRoutes(request, env, identity);
      if (agent) return agent;
    }
    const extension = await handleExtensions(request, env, identity);
    if (extension) return extension;
    return json({ error: "not_found" }, 404);
  } catch (error) {
    const response = errorResponse(error);
    const path = new URL(request.url).pathname;
    if (isPrivateNoStorePath(path))
      response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
