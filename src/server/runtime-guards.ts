// 通常運用と旧検証の両方で使う実行時ガード。認証・所有権を確認した入口から呼ぶ。
// 旧検証専用の判定（固定窓・3回・入力上限）は ai-verification.ts に置く。
import { verificationModelId } from "./ai/catalog";
import type { AppEnv } from "./env";
import { ApiError } from "./http";
import {
  type ChatPolicy,
  type RuntimePolicyInput,
  resolveRuntimePolicy,
} from "./runtime-policy";

export type RuntimeEnv = AppEnv & RuntimePolicyInput;

// 行なしの結果はcacheしない。
export async function checkRuntimeBoundary(env: RuntimeEnv) {
  const boundary = resolveRuntimePolicy(env).boundary;
  if (!boundary.ok) throw new ApiError(503, boundary.code);
  if (
    boundary.value.kind === "standard" &&
    boundary.value.requiresVerificationLedgerCheck
  ) {
    let present: { present: number } | null;
    try {
      present = await env.DB.prepare(
        "SELECT 1 AS present FROM ai_verification LIMIT 1",
      ).first<{ present: number }>();
    } catch {
      // 未適用tableも通信/SQL失敗も固定コードで拒否。生の例外を出さない。
      throw new ApiError(503, "verification_ledger_unavailable");
    }
    if (present !== null) throw new ApiError(503, "legacy_verification_ledger");
  }
  return boundary.value;
}

export async function checkChatRuntimePolicy(env: RuntimeEnv) {
  await checkRuntimeBoundary(env);
  const chat = resolveRuntimePolicy(env).chat;
  if (!chat.ok) throw new ApiError(503, chat.code);
  return chat.value;
}

// OFF/旧検証の404は認証や設定/台帳照会より先に判定する。
export function requireExtensionEnabled(
  env: RuntimeEnv,
  flag: string | undefined,
  code = "feature_disabled",
) {
  if (
    flag !== "true" ||
    (env.APP_ENV === "staging" &&
      (env.STAGING_POLICY === undefined ||
        env.STAGING_POLICY === "verification"))
  )
    throw new ApiError(404, code);
}

// 各入口の入力/所有権/状態確認後、関連更新と外部呼出し直前に使う。
// チャット/Jevの設定不備だけでは独立拡張を止めない。
export async function checkExtensionRuntimePolicy(env: RuntimeEnv) {
  const boundary = await checkRuntimeBoundary(env);
  if (boundary.kind === "verification")
    throw new ApiError(404, "feature_disabled");
}

export function chatModelAllowed(policy: ChatPolicy, modelId: string) {
  switch (policy.mode) {
    case "verification":
      return modelId === verificationModelId;
    case "off":
      return false;
    case "local-demo":
      return modelId === "local/demo";
    case "selected":
      return policy.allowedModels.some((id) => id === modelId);
  }
}
