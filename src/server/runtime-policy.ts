// B-1: 設定だけの純粋な判定。認証・Secret・binding・D1・外部通信を扱わない。
// B-2/B-3のHTTP・adapter・拡張へ接続済み。Jev serviceはB-3J。
import {
  type SelectableChatModelId,
  selectableChatModelIds,
} from "./ai/catalog";

export {
  type SelectableChatModelId,
  selectableChatModelIds,
} from "./ai/catalog";
export type RuntimePolicyInput = Readonly<{
  APP_ENV?: string;
  APP_ORIGIN?: string;
  LOCAL_DEMO?: string;
  AI_VERIFICATION_ENABLED?: string;
  AI_VERIFICATION_START?: string;
}> &
  Readonly<{
    STAGING_POLICY?: string;
    AI_MODE?: string;
    AI_ALLOWED_MODELS?: string;
    JEV_MODE?: string;
    JEV_MODEL?: string;
  }>;

export type AppEnvironment = "local" | "staging" | "production";
export type StagingPolicy = "verification" | "standard";
export type AiMode = "off" | "local-demo" | "selected";
export type JevMode = "off" | "remote";

// 2026-10-02に公式Modelsで確認した固定版。aliasや自由な版指定は許可しない。
export const allowedJevModelIds = ["jev-1.13.0"] as const;
export type JevModelId = (typeof allowedJevModelIds)[number];

export type PolicyErrorCode =
  | "invalid_application_environment"
  | "invalid_application_origin"
  | "invalid_staging_policy"
  | "legacy_verification_settings"
  | "verification_ai_settings_forbidden"
  | "invalid_ai_mode"
  | "invalid_local_demo"
  | "invalid_allowed_models"
  | "local_model_forbidden"
  | "invalid_jev_mode"
  | "invalid_jev_model"
  | "verification_jev_forbidden";

export type PolicyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: PolicyErrorCode };

export type EnvironmentPolicy =
  | {
      readonly kind: "verification";
      readonly environment: "staging";
    }
  | {
      readonly kind: "standard";
      readonly environment: AppEnvironment;
      // trueはDB検査が済んだ意味ではない。B-2の非同期guardが必須。
      readonly requiresVerificationLedgerCheck: boolean;
    };

export type ChatPolicy =
  | { readonly mode: "verification" } // 旧制御への委譲。実行許可ではない。
  | { readonly mode: "off" }
  | { readonly mode: "local-demo" }
  | {
      readonly mode: "selected";
      readonly allowedModels: readonly SelectableChatModelId[];
    };

export type JevPolicy =
  | { readonly mode: "off" }
  | { readonly mode: "remote"; readonly model: JevModelId };

export type RuntimePolicy = {
  readonly boundary: PolicyResult<EnvironmentPolicy>;
  readonly chat: PolicyResult<ChatPolicy>;
  readonly jev: PolicyResult<JevPolicy>;
};

function success<T>(value: T): PolicyResult<T> {
  return { ok: true, value };
}

function failure(code: PolicyErrorCode): { ok: false; code: PolicyErrorCode } {
  // 入力、URL、JSON parse例外を含めない固定コードだけを返す。
  return { ok: false, code };
}

function validOrigin(origin: string | undefined, local: boolean): boolean {
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (local
        ? ["http:", "https:"].includes(url.protocol) &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        : url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function environmentPolicy(
  input: RuntimePolicyInput,
): PolicyResult<EnvironmentPolicy> {
  const environment = input.APP_ENV;
  if (
    environment !== "local" &&
    environment !== "staging" &&
    environment !== "production"
  )
    return failure("invalid_application_environment");
  if (!validOrigin(input.APP_ORIGIN, environment === "local"))
    return failure("invalid_application_origin");

  if (environment === "staging") {
    const staging = input.STAGING_POLICY ?? "verification";
    if (staging === "verification")
      return success({ kind: "verification", environment });
    if (staging !== "standard") return failure("invalid_staging_policy");
  } else if (input.STAGING_POLICY !== undefined) {
    return failure("invalid_staging_policy");
  }

  if (
    (input.AI_VERIFICATION_ENABLED !== undefined &&
      input.AI_VERIFICATION_ENABLED !== "false") ||
    (input.AI_VERIFICATION_START !== undefined &&
      input.AI_VERIFICATION_START !== "")
  )
    return failure("legacy_verification_settings");
  return success({
    kind: "standard",
    environment,
    requiresVerificationLedgerCheck: environment === "staging",
  });
}

function chatPolicy(
  input: RuntimePolicyInput,
  boundary: EnvironmentPolicy,
): PolicyResult<ChatPolicy> {
  if (boundary.kind === "verification") {
    if (input.AI_MODE !== undefined || input.AI_ALLOWED_MODELS !== undefined)
      return failure("verification_ai_settings_forbidden");
    // LOCAL_DEMO/認証/拡張/期限/binding/台帳は旧verificationSettingsで判定。
    return success({ mode: "verification" });
  }

  const mode =
    input.AI_MODE ??
    (boundary.environment === "local" && input.LOCAL_DEMO === "true"
      ? "local-demo"
      : "off");
  if (mode !== "off" && mode !== "local-demo" && mode !== "selected")
    return failure("invalid_ai_mode");
  if (
    (mode === "local-demo" && boundary.environment !== "local") ||
    input.LOCAL_DEMO !== (mode === "local-demo" ? "true" : "false")
  )
    return failure("invalid_local_demo");

  let models: unknown = [];
  if (input.AI_ALLOWED_MODELS !== undefined) {
    try {
      models = JSON.parse(input.AI_ALLOWED_MODELS);
    } catch {
      return failure("invalid_allowed_models");
    }
  }
  if (!Array.isArray(models)) return failure("invalid_allowed_models");
  if (mode !== "selected")
    return models.length === 0
      ? success({ mode })
      : failure("invalid_allowed_models");
  if (
    models.length === 0 ||
    models.some(
      (id) =>
        typeof id !== "string" ||
        !selectableChatModelIds.some((allowed) => allowed === id),
    ) ||
    new Set(models).size !== models.length
  )
    return failure("invalid_allowed_models");
  if (boundary.environment !== "local" && models.includes("lm-studio/local"))
    return failure("local_model_forbidden");
  return success({
    mode,
    allowedModels: models as SelectableChatModelId[],
  });
}

function jevPolicy(
  input: RuntimePolicyInput,
  boundary: EnvironmentPolicy,
): PolicyResult<JevPolicy> {
  const mode = input.JEV_MODE ?? "off";
  if (mode !== "off" && mode !== "remote") return failure("invalid_jev_mode");
  if (mode === "off")
    return input.JEV_MODEL === undefined
      ? success({ mode })
      : failure("invalid_jev_model");
  if (boundary.kind === "verification")
    return failure("verification_jev_forbidden");
  const model = allowedJevModelIds.find((id) => id === input.JEV_MODEL);
  if (!model) return failure("invalid_jev_model");
  return success({ mode, model });
}

/** 成功は設定契約の適合だけ。認証・DB・資格情報・実接続は別途確認が必要。 */
export function resolveRuntimePolicy(input: RuntimePolicyInput): RuntimePolicy {
  const boundary = environmentPolicy(input);
  if (!boundary.ok) return { boundary, chat: boundary, jev: boundary };
  // 片方の設定不備で他方や認証・履歴操作を止めないよう結果を分離する。
  return {
    boundary,
    chat: chatPolicy(input, boundary.value),
    jev: jevPolicy(input, boundary.value),
  };
}
