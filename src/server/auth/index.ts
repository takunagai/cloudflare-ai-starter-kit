import type { AppEnv, Identity } from "../env";
import { verifyAccessIdentity } from "./access";
import { createAuth, isLocalAuth } from "./better-auth";
import { type AuthMailer, createCloudflareMailer } from "./email";

function failure(error: string, status: number) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function getAuthMailer(env: AppEnv): AuthMailer | undefined {
  // Wranglerのlocal emailシミュレーションは本文をログへ出すため使用しない。
  // remote bindingの誤設定による実送信もlocalでは行わない。
  if (env.APP_ENV === "local") return undefined;
  return createCloudflareMailer(env);
}

export async function getIdentity(
  request: Request,
  env: AppEnv,
): Promise<Identity | null> {
  if (env.AUTH_MODE === "access") return verifyAccessIdentity(request, env);
  if (env.AUTH_MODE !== "better-auth") return null;
  try {
    const auth = createAuth(env, { mailer: getAuthMailer(env) });
    const result = await auth.api.getSession({ headers: request.headers });
    if (!result || (!isLocalAuth(env) && !result.user.emailVerified))
      return null;
    return {
      id: `better-auth:${result.user.id}`,
      email: result.user.email,
      name: result.user.name,
    };
  } catch {
    return null;
  }
}

export async function handleAuth(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  if (env.AUTH_MODE !== "better-auth")
    return failure("auth_mode_unavailable", 404);
  try {
    const mailer = getAuthMailer(env);
    const auth = createAuth(env, {
      mailer,
      runInBackground(task) {
        waitUntil(
          task.catch(() => {
            // 固定イベント名だけ。宛先、token、URL、SDK例外を記録しない。
            console.warn("auth_email_delivery_failed");
          }),
        );
      },
    });
    const path = new URL(request.url).pathname;
    if (
      !mailer &&
      [
        "/api/auth/request-password-reset",
        "/api/auth/send-verification-email",
      ].includes(path)
    ) {
      return failure("email_not_configured", 503);
    }
    const response = await auth.handler(request);
    if (response.status >= 500) return failure("auth_unavailable", 503);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return failure("auth_unavailable", 503);
  }
}

import { waitUntil } from "cloudflare:workers";
