import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "../db/auth-schema";
import type { AppEnv } from "../env";
import { AuthConfigurationError, type AuthMailer } from "./email";

// 公開されたダミー。localhostの開発DB以外に利用してはいけない。
export const LOCAL_AUTH_SECRET =
  "local-only-public-dummy-secret-never-use-in-production-2026";

export function isLocalAuth(
  env: Pick<AppEnv, "APP_ORIGIN" | "APP_ENV">,
): boolean {
  try {
    const url = new URL(env.APP_ORIGIN);
    return (
      env.APP_ENV === "local" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol) &&
      url.origin === env.APP_ORIGIN
    );
  } catch {
    return false;
  }
}

export function createAuth(
  env: AppEnv,
  options: {
    mailer?: AuthMailer;
    runInBackground?: (task: Promise<unknown>) => void;
  } = {},
) {
  const local = isLocalAuth(env);
  let origin: URL;
  try {
    origin = new URL(env.APP_ORIGIN);
  } catch {
    throw new AuthConfigurationError();
  }
  if (
    origin.origin !== env.APP_ORIGIN ||
    (env.APP_ENV === "local" && !local) ||
    (!local && origin.protocol !== "https:")
  )
    throw new AuthConfigurationError();
  const secret =
    env.BETTER_AUTH_SECRET || (local ? LOCAL_AUTH_SECRET : undefined);
  if (
    !secret ||
    secret.length < 32 ||
    (!local && secret === LOCAL_AUTH_SECRET)
  ) {
    throw new AuthConfigurationError();
  }
  if (!local && !options.mailer) throw new AuthConfigurationError();
  if (!!env.GOOGLE_CLIENT_ID !== !!env.GOOGLE_CLIENT_SECRET)
    throw new AuthConfigurationError();

  const send = async (
    to: string,
    url: string,
    purpose: "verification" | "password-reset",
  ) => {
    if (!options.mailer) throw new AuthConfigurationError();
    // HTTP経路はBetter AuthのbackgroundTasksをwaitUntilに接続する。
    // テストではawaitし、メール境界だけをfakeにする。
    await options.mailer.send({ to, url, purpose });
  };
  return betterAuth({
    appName: "Cloudflare AI Starter",
    baseURL: env.APP_ORIGIN,
    basePath: "/api/auth",
    secret,
    trustedOrigins: local
      ? [
          env.APP_ORIGIN,
          "http://127.0.0.1:3000",
          "http://localhost:3000",
          "http://127.0.0.1:4173",
          "http://localhost:4173",
        ]
      : [env.APP_ORIGIN],
    logger: { disabled: true },
    database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: !local,
      autoSignIn: local,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) =>
        send(user.email, url, "password-reset"),
    },
    emailVerification: {
      sendOnSignUp: !local,
      sendOnSignIn: !local,
      autoSignInAfterVerification: false,
      sendVerificationEmail: ({ user, url }) =>
        send(user.email, url, "verification"),
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    advanced: {
      backgroundTasks: options.runInBackground
        ? { handler: options.runInBackground }
        : undefined,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: !local || origin.protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
  });
}
