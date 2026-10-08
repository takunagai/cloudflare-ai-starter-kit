import type { PendingRequest } from "../lib/reliability";
import { ClientError } from "./api-client";

// 利用者ごとに未確認の要求IDと会話IDだけを記録する。本文・回答・出典は保存しない。
const PREFIX = "chat-request:";
export function pendingRequest(owner: string): PendingRequest | null {
  try {
    const value = localStorage.getItem(PREFIX + owner);
    if (!value) return null;
    const parsed = JSON.parse(value) as PendingRequest;
    if (
      !/^[a-f0-9-]{36}$/.test(parsed.requestId) ||
      !/^[a-f0-9-]{36}$/.test(parsed.conversationId)
    )
      throw new Error("invalid");
    return parsed;
  } catch {
    throw new ClientError("local_recovery_unavailable");
  }
}
export function rememberRequest(owner: string, pending: PendingRequest) {
  try {
    localStorage.setItem(PREFIX + owner, JSON.stringify(pending));
  } catch {
    throw new ClientError("local_recovery_unavailable");
  }
}
export function forgetRequest(owner: string, requestId: string) {
  if (pendingRequest(owner)?.requestId !== requestId) return;
  try {
    localStorage.removeItem(PREFIX + owner);
  } catch {
    throw new ClientError("local_recovery_unavailable");
  }
}
