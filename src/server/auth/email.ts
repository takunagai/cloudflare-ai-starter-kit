/** 実メール送信はこの境界だけで行う。fakeはテストから直接注入する。 */
export interface AuthEmail {
  to: string;
  purpose: "verification" | "password-reset";
  url: string;
}

export interface AuthMailer {
  send(message: AuthEmail): Promise<void>;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

export function createCloudflareMailer(
  env: Pick<AppEnv, "EMAIL" | "EMAIL_FROM" | "APP_ORIGIN">,
): AuthMailer | undefined {
  if (!env.EMAIL && !env.EMAIL_FROM) return undefined;
  if (
    !env.EMAIL ||
    !env.EMAIL_FROM ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.EMAIL_FROM)
  )
    throw new AuthConfigurationError();
  const binding = env.EMAIL;
  const from = env.EMAIL_FROM;
  return {
    async send(message) {
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(message.to))
        throw new AuthConfigurationError();
      const target = new URL(message.url);
      if (
        target.origin !== env.APP_ORIGIN ||
        !target.pathname.startsWith("/api/auth/")
      )
        throw new AuthConfigurationError();
      const subject =
        message.purpose === "verification"
          ? "メールアドレスを確認してください"
          : "パスワードを再設定してください";
      const instruction =
        "この操作を依頼した場合だけ、次のリンクを開いてください。心当たりがなければこのメールを破棄してください。";
      try {
        await binding.send({
          from,
          to: message.to,
          subject,
          text: `${instruction}\n\n${message.url}`,
          html: `<p>${instruction}</p><p><a href="${escapeHtml(message.url)}">${subject}</a></p>`,
        });
      } catch {
        // binding由来の例外には送信先や本文が含まれる可能性がある。
        throw new Error("auth_email_delivery_failed");
      }
    },
  };
}

export class AuthConfigurationError extends Error {
  constructor() {
    // 設定・Secret・URL・外部SDKの例外をメッセージに埋め込まない。
    super("Authentication is not configured");
    this.name = "AuthConfigurationError";
  }
}

import type { AppEnv } from "../env";
