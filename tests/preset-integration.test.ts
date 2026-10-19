import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  applyDecisionMetadata,
  classificationFixtures,
  classifyOnce,
  readDecisionMetadata,
} from "../src/lib/decision-example";
import api from "../src/server/api";
import { getDecisionRow } from "../src/server/decisions/ledger";
import type { DecisionEnv } from "../src/server/decisions/service";
import type { Identity, PublicModel } from "../src/server/env";

// D-1: client → API → real auth/D1. Only mail/JWKS/Jev boundaries are fake.
const db = env.DB as D1Database;
const issuer = "https://example-d1.cloudflareaccess.com";
const password = "TEST_ONLY_D1_local_password";
const synthetic = classificationFixtures[0];
const cases = [
  ["staging", "access"],
  ["staging", "better-auth"],
  ["production", "access"],
  ["production", "better-auth"],
] as const;
type Config = { -readonly [K in keyof DecisionEnv]: DecisionEnv[K] };
let config: Config;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: Awaited<ReturnType<typeof exportJWK>>[] };
let deliveries: EmailMessageBuilder[];
let upstream: ReturnType<typeof vi.fn<typeof fetch>>;

beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
  jwks = {
    keys: [
      { ...(await exportJWK(keys.publicKey)), kid: "d1-test", alg: "RS256" },
    ],
  };
});
beforeEach(async () => {
  // These are isolated test bindings, never the dev/preview or legacy DB.
  for (const table of [
    "decision_requests",
    "app_rate_limits",
    "ai_verification",
    "conversations",
    "chat_requests",
    "auth_session",
    "auth_account",
    "auth_verification",
    "auth_user",
    "auth_rate_limit",
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
  deliveries = [];
  config = {
    ...env,
    DB: db,
    APP_ENV: "staging",
    APP_ORIGIN: "https://preset.example.invalid",
    STAGING_POLICY: "standard",
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: "example-d1.cloudflareaccess.com",
    ACCESS_AUD: "TEST_ONLY_D1_audience",
    BETTER_AUTH_SECRET: "TEST_ONLY_D1_fixture_012345678901234567890123456789",
    EMAIL_FROM: "noreply@example.test",
    EMAIL: {
      async send(message: EmailMessageBuilder) {
        deliveries.push(message);
        return { messageId: "TEST_ONLY_D1_message" };
      },
    } as SendEmail,
    LOCAL_DEMO: "false",
    AI_MODE: "off",
    AI_ALLOWED_MODELS: undefined,
    JEV_MODE: "remote",
    JEV_MODEL: "jev-1.13.0",
    TYPESAFE_API_KEY: "TEST_ONLY_D1_dummy_key",
    AI_VERIFICATION_ENABLED: "false",
    AI_VERIFICATION_START: "",
    ENABLE_RAG: "false",
    ENABLE_AGENT: "false",
    ENABLE_WORKFLOWS: "false",
    ENABLE_IMAGES: "false",
    ENABLE_BILLING: "false",
  };
  upstream = vi.fn<typeof fetch>(async () =>
    Response.json({
      model: synthetic.result.model,
      answers: { intent: synthetic.result.answer },
      usage: {
        input_tokens: synthetic.result.usage.inputTokens,
        output_tokens: synthetic.result.usage.outputTokens,
      },
    }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `${issuer}/cdn-cgi/access/certs`) return Response.json(jwks);
    if (url === "https://api.typesafe.ai/v1/systemone")
      return upstream(input, init);
    throw new Error("unexpected_network");
  });
});
afterEach(() => vi.restoreAllMocks());

function request(
  path: string,
  headers: HeadersInit = {},
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  return new Request(config.APP_ORIGIN + path, {
    method,
    headers: {
      Origin: config.APP_ORIGIN,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function call(request: Request) {
  const ctx = createExecutionContext();
  const response = await api.fetch(request, config, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
async function login(
  mode: "access" | "better-auth",
  subject = "alice",
): Promise<Record<string, string>> {
  config.AUTH_MODE = mode;
  if (mode === "access") {
    const token = await new SignJWT({
      sub: subject,
      email: `${subject}@example.test`,
      type: "app",
    })
      .setProtectedHeader({ alg: "RS256", kid: "d1-test" })
      .setIssuer(issuer)
      .setAudience(config.ACCESS_AUD ?? "")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    return { "cf-access-jwt-assertion": token };
  }
  expect(
    (
      await call(
        request(
          "/api/auth/sign-up/email",
          {},
          {
            name: subject,
            email: `${subject}@example.test`,
            password,
          },
        ),
      )
    ).status,
  ).toBe(200);
  const verification = deliveries
    .at(-1)
    ?.text?.split("\n")
    .find((line) => line.startsWith("https://"));
  expect(Boolean(verification)).toBe(true);
  expect(
    (await call(new Request(verification ?? "https://invalid.test"))).status,
  ).toBe(302);
  const response = await call(
    request(
      "/api/auth/sign-in/email",
      {},
      { email: `${subject}@example.test`, password },
    ),
  );
  expect(response.status).toBe(200);
  return {
    Cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}
async function session(headers: HeadersInit) {
  const response = await call(request("/api/session", headers));
  expect(response.status).toBe(200);
  return ((await response.json()) as { identity: Identity }).identity;
}
function target(environment: "staging" | "production") {
  config.APP_ENV = environment;
  config.STAGING_POLICY = environment === "staging" ? "standard" : undefined;
}
const key = () =>
  `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`;
function client(headers: HeadersInit) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const merged = new Headers(init?.headers);
    merged.set("Origin", config.APP_ORIGIN);
    new Headers(headers).forEach((value, name) => {
      merged.set(name, value);
    });
    expect(init?.redirect).toBe("error");
    // Browser fetch supports redirect:error; workerd Request supports manual.
    // The bridge must reject redirects, never silently follow them.
    const response = await call(
      new Request(config.APP_ORIGIN + String(input), {
        ...init,
        redirect: "manual",
        headers: merged,
      }),
    );
    if (response.status >= 300 && response.status < 400)
      throw new Error("TEST_ONLY_D1_redirect_rejected");
    return response;
  });
}

describe("D-1 preset auth/client/API/D1 integration", () => {
  it.each(cases)(
    "%s/%s: validates the real API response and owner-only metadata without replay",
    async (environment, mode) => {
      target(environment);
      const headers = await login(mode);
      const owner = await session(headers);
      const fetcher = client(headers);
      const requestKey = key();
      const result = await classifyOnce(requestKey, synthetic.input, fetcher);
      expect(result.disposition).toBe("terminal");
      expect(result.result).toEqual({ ...synthetic.result, requestKey });
      const before = await getDecisionRow(db, owner.id, requestKey);
      expect(before).toMatchObject({ state: "succeeded", attempt_count: 1 });
      const metadata = await readDecisionMetadata(requestKey, fetcher);
      expect(metadata).toMatchObject({
        state: "succeeded",
        resultAvailable: false,
      });
      expect(await getDecisionRow(db, owner.id, requestKey)).toEqual(before);
      expect(
        (await classifyOnce(requestKey, "別の架空入力", fetcher)).code,
      ).toBe("decision_already_used");
      const other = await login(mode, "bob");
      await expect(
        readDecisionMetadata(requestKey, client(other)),
      ).rejects.toThrow("status_unavailable");
      expect(await getDecisionRow(db, owner.id, requestKey)).toEqual(before);
      expect(upstream).toHaveBeenCalledTimes(1);
    },
  );

  it.each(cases)(
    "%s/%s: lost POST response unlocks only after matching owner metadata, with no result restoration",
    async (environment, mode) => {
      target(environment);
      const headers = await login(mode);
      const owner = await session(headers);
      const server = client(headers);
      const transport = vi.fn<typeof fetch>(async (input, init) => {
        const response = await server(input, init);
        if (init?.method === "POST") {
          expect(response.status).toBe(200);
          await response.arrayBuffer();
          throw new Error("TEST_ONLY_D1_response_lost");
        }
        return response;
      });
      const requestKey = key();
      const attempt = await classifyOnce(
        requestKey,
        synthetic.input,
        transport,
      );
      expect(attempt).toEqual({
        key: requestKey,
        disposition: "unresolved",
        code: "decision_response_lost",
      });
      expect(transport).toHaveBeenCalledTimes(1);
      const before = await getDecisionRow(db, owner.id, requestKey);
      const metadata = await readDecisionMetadata(requestKey, transport);
      const recovered = applyDecisionMetadata(attempt, metadata);
      expect(recovered.disposition).toBe("terminal");
      expect(recovered.result).toBeUndefined();
      expect(metadata.resultAvailable).toBe(false);
      expect(await getDecisionRow(db, owner.id, requestKey)).toEqual(before);
      expect(
        transport.mock.calls.map(([, init]) => init?.method ?? "GET"),
      ).toEqual(["POST", "GET"]);
      expect(upstream).toHaveBeenCalledTimes(1);
    },
  );

  it.each(cases)(
    "%s/%s: unknown stays consumed through OFF/configuration/legacy recovery and blocks another claim",
    async (environment, mode) => {
      target(environment);
      const headers = await login(mode);
      const owner = await session(headers);
      const fetcher = client(headers);
      upstream.mockRejectedValue(
        new Error("TEST_ONLY_D1_upstream_connection_lost"),
      );
      const requestKey = key();
      const attempt = await classifyOnce(requestKey, synthetic.input, fetcher);
      expect(attempt.disposition).toBe("unresolved");
      const before = await getDecisionRow(db, owner.id, requestKey);
      expect(before).toMatchObject({
        state: "submission_unknown",
        attempt_count: 1,
        expires_at: null,
      });
      const blockedKey = key();
      expect(
        (await classifyOnce(blockedKey, synthetic.input, fetcher)).code,
      ).toBe("decision_limit_exceeded");
      expect(await getDecisionRow(db, owner.id, blockedKey)).toBeNull();
      config.AI_MODE = "TEST_ONLY_invalid";
      if (environment === "staging") {
        await db
          .prepare(
            "INSERT INTO ai_verification VALUES (1,'TEST_ONLY_D1_legacy',0,1800000,3)",
          )
          .run();
      }
      const legacyBefore = (
        await db.prepare("SELECT * FROM ai_verification").all()
      ).results;
      for (const patch of [
        { JEV_MODE: "off", JEV_MODEL: undefined },
        { JEV_MODE: "remote", JEV_MODEL: "jev-latest" },
        {
          JEV_MODE: "remote",
          JEV_MODEL: "jev-1.13.0",
          TYPESAFE_API_KEY: undefined,
        },
      ]) {
        Object.assign(config, patch);
        const metadata = await readDecisionMetadata(requestKey, fetcher);
        expect(metadata.state).toBe("submission_unknown");
        expect(applyDecisionMetadata(attempt, metadata).disposition).toBe(
          "unresolved",
        );
        expect(await getDecisionRow(db, owner.id, requestKey)).toEqual(before);
      }
      const models = await call(request("/api/models", headers));
      expect(models.status).toBe(200);
      expect(
        ((await models.json()) as { models: PublicModel[] }).models.every(
          (model) => !model.available,
        ),
      ).toBe(true);
      const created = await call(
        request("/api/conversations", headers, {
          title: "D1 synthetic recovery",
        }),
      );
      expect(created.status).toBe(201);
      const id = ((await created.json()) as { conversation: { id: string } })
        .conversation.id;
      expect(
        (await call(request(`/api/conversations/${id}`, headers))).status,
      ).toBe(200);
      expect(
        (await call(request(`/api/conversations/${id}`, headers, {}, "DELETE")))
          .status,
      ).toBe(200);
      expect(
        (await db.prepare("SELECT * FROM ai_verification").all()).results,
      ).toEqual(legacyBefore);
      Object.assign(config, {
        JEV_MODE: "remote",
        JEV_MODEL: "jev-1.13.0",
        TYPESAFE_API_KEY: "TEST_ONLY_D1_dummy_key",
        AI_MODE: "off",
      });
      const secondKey = key();
      const refused = await call(
        request("/api/decisions/classify", headers, {
          requestKey: secondKey,
          input: synthetic.input,
        }),
      );
      expect(refused.status).toBe(environment === "staging" ? 503 : 429);
      expect(await refused.json()).toEqual({
        error:
          environment === "staging"
            ? "legacy_verification_ledger"
            : "decision_limit_exceeded",
      });
      expect(await getDecisionRow(db, owner.id, secondKey)).toBeNull();
      expect(await getDecisionRow(db, owner.id, requestKey)).toEqual(before);
      expect(upstream).toHaveBeenCalledTimes(1);
      if (mode === "better-auth") {
        expect(
          (await call(request("/api/auth/sign-out", headers, {}))).status,
        ).toBe(200);
        await expect(readDecisionMetadata(requestKey, fetcher)).rejects.toThrow(
          "status_unavailable",
        );
      }
    },
  );

  it.each(["staging", "production"] as const)(
    "%s: same email cannot merge Access and Better Auth decision owners or mix credentials",
    async (environment) => {
      target(environment);
      const access = await login("access");
      const accessOwner = await session(access);
      const requestKey = key();
      expect(
        (await classifyOnce(requestKey, synthetic.input, client(access)))
          .result,
      ).toBeDefined();
      const better = await login("better-auth");
      const betterOwner = await session(better);
      expect(accessOwner.email).toBe(betterOwner.email);
      expect(accessOwner.id).not.toBe(betterOwner.id);
      expect(accessOwner.id.startsWith("access:")).toBe(true);
      expect(betterOwner.id.startsWith("better-auth:")).toBe(true);
      await expect(
        readDecisionMetadata(requestKey, client(access)),
      ).rejects.toThrow("status_unavailable");
      await expect(
        readDecisionMetadata(requestKey, client(better)),
      ).rejects.toThrow("status_unavailable");
      expect(
        (await classifyOnce(requestKey, synthetic.input, client(better)))
          .result,
      ).toBeDefined();
      config.AUTH_MODE = "access";
      await expect(
        readDecisionMetadata(requestKey, client(better)),
      ).rejects.toThrow("status_unavailable");
      const accessRow = await getDecisionRow(db, accessOwner.id, requestKey);
      const betterRow = await getDecisionRow(db, betterOwner.id, requestKey);
      const accessMetadata = await readDecisionMetadata(
        requestKey,
        client(access),
      );
      expect(accessMetadata.createdAt).toBe(accessRow?.created_at);
      expect(accessMetadata.state).toBe("succeeded");
      expect(betterRow).toMatchObject({ state: "succeeded", attempt_count: 1 });
      expect(upstream).toHaveBeenCalledTimes(2);
    },
  );
});
