import {
  checkExtensionRuntimePolicy,
  requireExtensionEnabled,
} from "../ai-verification";
import type { AppEnv } from "../env";
import { ApiError } from "../http";
import type { RuntimePolicyInput } from "../runtime-policy";
import { MEDIA_MODEL_IDS, type MediaModelId } from "./catalog";

export type MediaEnv = AppEnv &
  RuntimePolicyInput & {
    ENABLE_MEDIA?: string;
    MEDIA_ALLOWED_MODELS?: string;
  };
export function mediaPolicy(
  env: Pick<MediaEnv, "ENABLE_MEDIA" | "MEDIA_ALLOWED_MODELS">,
) {
  const flag = env.ENABLE_MEDIA ?? "false";
  if (flag !== "true" && flag !== "false")
    throw new ApiError(503, "media_configuration_invalid");
  let allowed: unknown = [];
  try {
    allowed = JSON.parse(env.MEDIA_ALLOWED_MODELS ?? "[]");
  } catch {
    throw new ApiError(503, "media_configuration_invalid");
  }
  if (
    !Array.isArray(allowed) ||
    allowed.some((id) => !MEDIA_MODEL_IDS.includes(id)) ||
    new Set(allowed).size !== allowed.length ||
    (flag === "false" && allowed.length !== 0) ||
    (flag === "true" && allowed.length === 0)
  )
    throw new ApiError(503, "media_configuration_invalid");
  return {
    isEnabled: flag === "true",
    allowedModels: allowed as MediaModelId[],
  };
}
export function requireMediaEnabled(env: MediaEnv) {
  requireExtensionEnabled(env, env.ENABLE_MEDIA, "media_disabled");
  return mediaPolicy(env);
}
export async function checkMediaExecution(env: MediaEnv, modelId: string) {
  const policy = requireMediaEnabled(env);
  if (!policy.allowedModels.some((id) => id === modelId))
    throw new ApiError(403, "media_model_not_allowed");
  await checkExtensionRuntimePolicy(env);
  if (!env.FAL_KEY) throw new ApiError(503, "media_not_configured");
}
