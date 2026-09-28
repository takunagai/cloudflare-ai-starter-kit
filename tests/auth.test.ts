import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getIdentity, handleAuth } from "../src/server/auth";
import { createAuth, LOCAL_AUTH_SECRET } from "../src/server/auth/better-auth";
import type { AuthEmail, AuthMailer } from "../src/server/auth/email";
import type { AppEnv } from "../src/server/env";

const local: AppEnv = {
  ...env,
  APP_ENV: "local",
  AUTH_MODE: "better-auth",
  APP_ORIGIN: "http://127.0.0.1:3000",
} as AppEnv;
const password = "TEST_ONLY_local_password_1";
const signup = { email: "alice@example.test", name: "Alice", password };

function request(
  path: string,
  body?: unknown,
  cookie?: string,
  origin = local.APP_ORIGIN,
) {
  return new Request(`${origin}/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "cf-connecting-ip": "192.0.2.1",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

beforeEach(async () => {
  await local.DB.batch([
    local.DB.prepare("DELETE FROM auth_session"),
    local.DB.prepare("DELETE FROM auth_account"),
    local.DB.prepare("DELETE FROM auth_verification"),
    local.DB.prepare("DELETE FROM auth_user"),
    local.DB.prepare("DELETE FROM auth_rate_limit"),
  ]);
});

describe("Better Auth on Workers + D1", () => {
  it("registers, persists a session, namespaces identity, and revokes logout", async () => {
    const response = await handleAuth(request("sign-up/email", signup), local);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const cookie = cookies(response);
    expect(cookie.length > 0).toBe(true);
    const user = await local.DB.prepare(
      "SELECT id FROM auth_user WHERE email = ?",
    )
      .bind(signup.email)
      .first<{ id: string }>();
    const identity = await getIdentity(
      request("get-session", undefined, cookie),
      local,
    );
    expect(identity?.id).toBe(`better-auth:${user?.id}`);
    expect(identity?.email).toBe(signup.email);
    const sessionCookie = response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="));
    expect(sessionCookie?.toLowerCase().includes("httponly")).toBe(true);
    expect(sessionCookie?.toLowerCase().includes("samesite=lax")).toBe(true);
    expect(await getIdentity(request("get-session"), local)).toBeNull();
    const loggedOut = await handleAuth(request("sign-out", {}, cookie), local);
    expect(loggedOut.status).toBe(200);
    expect(
      await getIdentity(request("get-session", undefined, cookie), local),
    ).toBeNull();
  });

  it("checks the password and rejects an expired database session", async () => {
    await handleAuth(request("sign-up/email", signup), local);
    const rejected = await handleAuth(
      request("sign-in/email", {
        email: signup.email,
        password: "TEST_ONLY_local_signup_password",
      }),
      local,
    );
    expect(rejected.status).toBe(401);
    const loggedIn = await handleAuth(
      request("sign-in/email", { email: signup.email, password }),
      local,
    );
    expect(loggedIn.status).toBe(200);
    await local.DB.prepare("UPDATE auth_session SET expires_at = 0").run();
    expect(
      await getIdentity(
        request("get-session", undefined, cookies(loggedIn)),
        local,
      ),
    ).toBeNull();
  });

  it("blocks cross-origin signup and logout and accepts the explicit local preview origin", async () => {
    const bad = await handleAuth(
      request("sign-up/email", signup, undefined, "https://attacker.test"),
      local,
    );
    expect(bad.status).toBe(403);
    const response = await handleAuth(
      request("sign-up/email", signup, undefined, "http://127.0.0.1:4173"),
      local,
    );
    expect(response.status).toBe(200);
    const cookie = cookies(response);
    const logout = await handleAuth(
      request("sign-out", {}, cookie, "https://attacker.test"),
      local,
    );
    expect(logout.status).toBe(403);
    expect(
      (await getIdentity(request("get-session", undefined, cookie), local)) !==
        null,
    ).toBe(true);
  });

  it("persists login rate limiting across fresh auth instances", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (
          await handleAuth(
            request("sign-in/email", { email: signup.email, password }),
            local,
          )
        ).status,
      );
    }
    expect(statuses.includes(429)).toBe(true);
    const count = await local.DB.prepare(
      "SELECT COUNT(*) AS n FROM auth_rate_limit",
    ).first<{ n: number }>();
    expect((count?.n ?? 0) > 0).toBe(true);
  });

  it("does not accept a forged Access identity in Better Auth mode or its cookie in Access mode", async () => {
    const forged = new Request(`${local.APP_ORIGIN}/api/auth/get-session`, {
      headers: {
        "cf-access-authenticated-user-email": signup.email,
        "cf-access-jwt-assertion": "forged",
      },
    });
    expect(await getIdentity(forged, local)).toBeNull();
    const response = await handleAuth(request("sign-up/email", signup), local);
    expect(
      await getIdentity(request("get-session", undefined, cookies(response)), {
        ...local,
        AUTH_MODE: "access",
      }),
    ).toBeNull();
    expect(
      (
        await handleAuth(request("sign-up/email", signup), {
          ...local,
          AUTH_MODE: "access",
        })
      ).status,
    ).toBe(404);
  });

  it("fails closed outside localhost without production secret and mailer", async () => {
    for (const config of [
      { ...local, APP_ORIGIN: "https://public.example.test" },
      {
        ...local,
        APP_ENV: "production" as const,
        APP_ORIGIN: "https://public.example.test",
      },
      {
        ...local,
        APP_ENV: "production" as const,
        APP_ORIGIN: "https://public.example.test",
        BETTER_AUTH_SECRET: LOCAL_AUTH_SECRET,
      },
    ]) {
      expect(
        (await handleAuth(request("sign-up/email", signup), config)).status,
      ).toBe(503);
    }
    expect(
      (
        await handleAuth(
          request("request-password-reset", { email: signup.email }),
          local,
        )
      ).status,
    ).toBe(503);
  });

  it("requires both Google credentials and does not require Google for the default app", async () => {
    const notConfigured = await handleAuth(
      request("sign-in/social", { provider: "google", callbackURL: "/app" }),
      local,
    );
    expect(notConfigured.status).toBe(404);
    const partial = await handleAuth(request("sign-up/email", signup), {
      ...local,
      GOOGLE_CLIENT_ID: "test-client",
    });
    expect(partial.status).toBe(503);
    const configured = await handleAuth(
      request("sign-in/social", { provider: "google", callbackURL: "/app" }),
      {
        ...local,
        GOOGLE_CLIENT_ID: "test-client",
        GOOGLE_CLIENT_SECRET: "test-fixture-only-secret",
      },
    );
    expect(configured.status).toBe(200);
    const payload = (await configured.json()) as { url?: string };
    const target = new URL(payload.url ?? "https://invalid.test");
    expect(target.hostname).toBe("accounts.google.com");
    expect(target.searchParams.get("redirect_uri")).toBe(
      `${local.APP_ORIGIN}/api/auth/callback/google`,
    );
  });

  it("cascades session and credential deletion when an account is removed", async () => {
    const response = await handleAuth(request("sign-up/email", signup), local);
    expect(response.status).toBe(200);
    await local.DB.prepare("DELETE FROM auth_user WHERE email = ?")
      .bind(signup.email)
      .run();
    expect(
      await getIdentity(
        request("get-session", undefined, cookies(response)),
        local,
      ),
    ).toBeNull();
    for (const name of ["auth_session", "auth_account"]) {
      const row = await local.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${name}`,
      ).first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });
});

describe("Verified email and password recovery", () => {
  const production: AppEnv = {
    ...local,
    APP_ENV: "production",
    APP_ORIGIN: "https://public.example.test",
    BETTER_AUTH_SECRET: "test-fixture-only-012345678901234567890123456789",
  };
  const sent: AuthEmail[] = [];
  const mailer: AuthMailer = {
    async send(message) {
      sent.push(message);
    },
  };
  const call = (path: string, body?: unknown, cookie?: string) =>
    request(path, body, cookie, production.APP_ORIGIN);

  beforeEach(() => {
    sent.length = 0;
  });

  it("connects the production HTTP handler to the Cloudflare mail adapter without exposing tokens", async () => {
    const deliveries: EmailMessageBuilder[] = [];
    const binding = {
      async send(message: EmailMessageBuilder) {
        deliveries.push(message);
        return { messageId: "fixture-message" };
      },
    } as SendEmail;
    const configured: AppEnv = {
      ...production,
      EMAIL: binding,
      EMAIL_FROM: "noreply@example.test",
    };
    const registered = await handleAuth(
      call("sign-up/email", { ...signup, callbackURL: "/app" }),
      configured,
    );
    expect(registered.status).toBe(200);
    expect(deliveries.length).toBe(1);
    const responseBody = await registered.text();
    expect(responseBody.includes("verify-email?")).toBe(false);
    expect(cookies(registered).includes("session_token=")).toBe(false);
    const url = deliveries[0].text
      ?.split("\n")
      .find((line) => line.startsWith("https://"));
    expect(!!url).toBe(true);
    expect(
      (await handleAuth(new Request(url ?? "https://invalid.test"), configured))
        .status,
    ).toBe(302);
    const login = await handleAuth(
      call("sign-in/email", { email: signup.email, password }),
      configured,
    );
    expect(login.status).toBe(200);
    expect(
      (
        await getIdentity(
          call("get-session", undefined, cookies(login)),
          configured,
        )
      )?.email,
    ).toBe(signup.email);
  });

  it("requires verified email and sends through a fake", async () => {
    const auth = createAuth(production, { mailer });
    const result = await auth.handler(call("sign-up/email", signup));
    expect(result.status).toBe(200);
    expect(cookies(result).includes("session_token=")).toBe(false);
    expect(sent.length).toBe(1);
    expect(sent[0].purpose).toBe("verification");
    const refused = await auth.handler(
      call("sign-in/email", { email: signup.email, password }),
    );
    expect(refused.status).toBe(403);
    const verified = await auth.handler(new Request(sent[0].url));
    expect(verified.status < 400).toBe(true);
    const loggedIn = await auth.handler(
      call("sign-in/email", { email: signup.email, password }),
    );
    expect(loggedIn.status).toBe(200);
    expect(
      loggedIn.headers
        .getSetCookie()
        .some((cookie) => cookie.toLowerCase().includes("secure")),
    ).toBe(true);
    const row = await production.DB.prepare(
      "SELECT email_verified AS verified FROM auth_user WHERE email = ?",
    )
      .bind(signup.email)
      .first<{ verified: number }>();
    expect(row?.verified).toBe(1);
  });

  it("resets once, revokes old sessions, and accepts only the new password", async () => {
    const auth = createAuth(production, { mailer });
    await auth.handler(call("sign-up/email", signup));
    await auth.handler(new Request(sent[0].url));
    const login = await auth.handler(
      call("sign-in/email", { email: signup.email, password }),
    );
    const reset = await auth.handler(
      call("request-password-reset", {
        email: signup.email,
        redirectTo: `${production.APP_ORIGIN}/app`,
      }),
    );
    expect(reset.status).toBe(200);
    const delivery = sent.find((item) => item.purpose === "password-reset");
    expect(!!delivery).toBe(true);
    // Better AuthのメールURLはcallback endpoint。HTTPのLocationを追ってフォームのtokenを得る。
    const redirected = await auth.handler(
      new Request(delivery?.url ?? "https://invalid.test"),
    );
    const redirect = redirected.headers.get("Location");
    expect(!!redirect).toBe(true);
    const token = new URL(redirect ?? "https://invalid.test").searchParams.get(
      "token",
    );
    expect(!!token).toBe(true);
    const newPassword = "changed-local-test-password-2026";
    const changed = await auth.handler(
      call("reset-password", { token, newPassword }),
    );
    expect(changed.status).toBe(200);
    const repeated = await auth.handler(
      call("reset-password", { token, newPassword }),
    );
    expect(repeated.status).toBe(400);
    const oldSession = await auth.api.getSession({
      headers: call("get-session", undefined, cookies(login)).headers,
    });
    expect(oldSession === null).toBe(true);
    expect(
      (
        await auth.handler(
          call("sign-in/email", { email: signup.email, password }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await auth.handler(
          call("sign-in/email", { email: signup.email, password: newPassword }),
        )
      ).status,
    ).toBe(200);
  });
});
