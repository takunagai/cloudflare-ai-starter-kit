import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env as bindings } from "cloudflare:workers";
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
import * as agentTools from "../src/server/agent-tools";
import { createLocalDemoModel } from "../src/server/ai/local-demo";
import * as providers from "../src/server/ai/providers";
import {
  checkRuntimeBoundary,
  type VerificationEnv,
  verificationModelId,
} from "../src/server/ai-verification";
import api from "../src/server/api";
import type { ChatInput } from "../src/server/chat-store";
import * as chatStore from "../src/server/chat-store";
import type { Identity, PublicModel } from "../src/server/env";

const ledgerQuery = "SELECT 1 AS present FROM ai_verification LIMIT 1";
const issuer = "https://example-b2.cloudflareaccess.com";
const password = "TEST_ONLY_B2_local_password";
const database = bindings.DB;
if (!database) throw new Error("local_test_database_missing");
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: Awaited<ReturnType<typeof exportJWK>>[] };
let config: VerificationEnv;
let run: ReturnType<typeof vi.fn>;
let deliveries: EmailMessageBuilder[];

beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
  jwks = {
    keys: [
      { ...(await exportJWK(keys.publicKey)), kid: "b2-test", alg: "RS256" },
    ],
  };
});

beforeEach(async () => {
  run = vi.fn(async () => ({ response: "Synthetic answer, AI unused" }));
  deliveries = [];
  config = {
    ...bindings,
    DB: database,
    APP_ENV: "staging",
    APP_ORIGIN: "https://standard.example.invalid",
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: "example-b2.cloudflareaccess.com",
    ACCESS_AUD: "TEST_ONLY_B2_audience",
    STAGING_POLICY: "standard",
    AI_MODE: "selected",
    AI_ALLOWED_MODELS: JSON.stringify([verificationModelId]),
    AI_VERIFICATION_ENABLED: "false",
    AI_VERIFICATION_START: "",
    LOCAL_DEMO: "false",
    ENABLE_RAG: "false",
    ENABLE_AGENT: "false",
    ENABLE_WORKFLOWS: "false",
    ENABLE_IMAGES: "false",
    ENABLE_BILLING: "false",
    AI: { run } as unknown as Ai,
    BETTER_AUTH_SECRET: "TEST_ONLY_B2_fixture_012345678901234567890123456789",
    EMAIL_FROM: "noreply@example.test",
    EMAIL: {
      async send(message: EmailMessageBuilder) {
        deliveries.push(message);
        return { messageId: "TEST_ONLY_B2_message" };
      },
    } as SendEmail,
  };
  await config.DB.batch([
    config.DB.prepare("DELETE FROM conversations"),
    config.DB.prepare("DELETE FROM chat_requests"),
    config.DB.prepare("DELETE FROM app_rate_limits"),
    config.DB.prepare("DELETE FROM ai_verification"),
    config.DB.prepare("DELETE FROM auth_session"),
    config.DB.prepare("DELETE FROM auth_account"),
    config.DB.prepare("DELETE FROM auth_verification"),
    config.DB.prepare("DELETE FROM auth_user"),
    config.DB.prepare("DELETE FROM auth_rate_limit"),
  ]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input) !== `${issuer}/cdn-cgi/access/certs`)
      throw new Error("unexpected_network");
    return Response.json(jwks);
  });
});
afterEach(() => vi.restoreAllMocks());

function req(
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
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const text = await response.text();
    await waitOnExecutionContext(ctx);
    return new Response(text, response);
  }
  await waitOnExecutionContext(ctx);
  return response;
}
async function signIn(
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
      .setProtectedHeader({ alg: "RS256", kid: "b2-test" })
      .setIssuer(issuer)
      .setAudience(config.ACCESS_AUD ?? "")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    return { "cf-access-jwt-assertion": token };
  }
  const signup = await call(
    req(
      "/api/auth/sign-up/email",
      {},
      {
        name: subject,
        email: `${subject}@example.test`,
        password,
      },
    ),
  );
  expect(signup.status).toBe(200);
  const url = deliveries
    .at(-1)
    ?.text?.split("\n")
    .find((line) => line.startsWith("https://"));
  expect(Boolean(url)).toBe(true);
  expect((await call(new Request(url ?? "https://invalid.test"))).status).toBe(
    302,
  );
  const login = await call(
    req(
      "/api/auth/sign-in/email",
      {},
      {
        email: `${subject}@example.test`,
        password,
      },
    ),
  );
  expect(login.status).toBe(200);
  return {
    Cookie: login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}
async function conversation(headers: HeadersInit) {
  const response = await call(
    req("/api/conversations", headers, { title: "B2 synthetic" }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { conversation: { id: string } })
    .conversation.id;
}
function input(conversationId: string): ChatInput {
  return {
    conversationId,
    requestId: crypto.randomUUID(),
    modelId: verificationModelId,
    message: "x".repeat(201),
    rag: false,
    agent: false,
  };
}
async function seedLedger() {
  await config.DB.prepare("INSERT INTO ai_verification VALUES (1,?,?,?,2)")
    .bind("TEST_ONLY_legacy_owner", 1, 1800001)
    .run();
}
async function ledger() {
  // 合成台帳の不変性確認。稼働DBの内容を取得する処理ではない。
  return config.DB.prepare("SELECT * FROM ai_verification").all();
}
async function models(headers: HeadersInit) {
  const response = await call(req("/api/models", headers));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return ((await response.json()) as { models: PublicModel[] }).models;
}

describe("B-2 authenticated standard staging on workerd/D1", () => {
  it("B-3: standard staging extension HTTP priorities and independent AI OFF", async () => {
    const headers = await signIn("access");
    config = {
      ...config,
      ENABLE_RAG: "true",
      ENABLE_AGENT: "true",
      ENABLE_IMAGES: "true",
      FAL_KEY: "TEST_ONLY_dummy",
      AI_MODE: "off",
      AI_ALLOWED_MODELS: "[]",
      JEV_MODE: "invalid",
    };
    const search = vi.fn(async () => ({ search_query: "test", chunks: [] }));
    config.AI_SEARCH = { search };
    expect(
      (
        await call(
          req("/api/extensions/rag/search", headers, { query: "test" }),
        )
      ).status,
    ).toBe(200);
    expect((await call(req("/api/extensions/images", headers))).status).toBe(
      200,
    );
    expect((await call(req("/api/notes", headers))).status).toBe(200);
    expect((await call(req("/api/approvals", headers))).status).toBe(200);
    await seedLedger();
    const prepare = vi.spyOn(config.DB, "prepare");
    expect((await call(req("/api/extensions/images"))).status).toBe(401);
    expect((await call(req("/api/extensions/workflows"))).status).toBe(404);
    expect(
      (await call(req("/api/extensions/rag/search", headers))).status,
    ).toBe(405);
    expect(
      (await call(req("/api/extensions/rag/search", headers, {}))).status,
    ).toBe(400);
    const text = req("/api/extensions/rag/search", headers, { query: "test" });
    text.headers.set("Content-Type", "text/plain");
    expect((await call(text)).status).toBe(415);
    expect(
      (
        await call(
          req("/api/extensions/rag/search", headers, {
            query: "x".repeat(33000),
          }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await call(
          req(`/api/extensions/images/${crypto.randomUUID()}`, headers),
        )
      ).status,
    ).toBe(404);
    expect(prepare.mock.calls.some(([sql]) => sql === ledgerQuery)).toBe(false);
    expect(
      (
        await call(
          req("/api/extensions/rag/search", headers, { query: "test" }),
        )
      ).status,
    ).toBe(503);
    expect(search).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it("B-3: agent rechecks ledger before its second model step", async () => {
    const headers = await signIn("access");
    const id = await conversation(headers);
    config.ENABLE_AGENT = "true";
    const demo = createLocalDemoModel();
    const doStream = vi.fn(demo.doStream);
    vi.spyOn(providers, "getModel").mockReturnValue({ ...demo, doStream });
    const noteTools = agentTools.noteTools;
    vi.spyOn(agentTools, "noteTools").mockImplementation((...args) => {
      const tools = noteTools(...args);
      const execute = tools.draftNote.execute;
      return {
        ...tools,
        draftNote: {
          ...tools.draftNote,
          execute: async (input, options) => {
            const result = await execute?.(input, options);
            if (!result || !("approvalId" in result))
              throw new Error("TEST_ONLY_expected_single_tool_result");
            await seedLedger();
            return result;
          },
        },
      };
    });
    const body = { ...input(id), agent: true };
    const response = await call(req("/api/chat", headers, body));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"code":"generation_failed"');
    expect(doStream).toHaveBeenCalledOnce();
    expect(
      await config.DB.prepare("SELECT status FROM chat_requests WHERE id=?")
        .bind(body.requestId)
        .first("status"),
    ).toBe("failed");
    expect(run).not.toHaveBeenCalled();
  });
  it("uses the normal daily and owner concurrency limits on standard staging", async () => {
    const headers = await signIn("access");
    const id = await conversation(headers);
    const otherId = await conversation(headers);
    const session = await call(req("/api/session", headers));
    const identity = ((await session.json()) as { identity: Identity })
      .identity;
    const first = input(id);
    await chatStore.reserveChat(config, identity, first);
    await expect(
      chatStore.reserveChat(config, identity, input(otherId)),
    ).rejects.toMatchObject({ code: "quota_or_concurrency_limit" });
    await chatStore.finishChat(config, identity, first, "", "failed");
    await config.DB.batch(
      Array.from({ length: 59 }, () =>
        config.DB.prepare(
          "INSERT INTO chat_requests(id,owner_id,conversation_id,model_id,input_hash,status,created_at) VALUES (?,?,?,?,?,'failed',?)",
        ).bind(
          crypto.randomUUID(),
          identity.id,
          id,
          verificationModelId,
          "TEST_ONLY_hash",
          Date.now(),
        ),
      ),
    );
    await expect(
      chatStore.reserveChat(config, identity, input(otherId)),
    ).rejects.toMatchObject({ code: "quota_or_concurrency_limit" });
    expect((await ledger()).results).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["local", "production"] as const)(
    "%s boundary does not read a legacy ledger",
    async (environment) => {
      const target: VerificationEnv = {
        ...config,
        APP_ENV: environment,
        APP_ORIGIN:
          environment === "local"
            ? "http://127.0.0.1:3000"
            : "https://production.example.invalid",
        STAGING_POLICY: undefined,
      };
      const prepare = vi.spyOn(config.DB, "prepare");
      await checkRuntimeBoundary(target);
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it.each(["access", "better-auth"] as const)(
    "%s: normal quota, streaming, replay, history and owner separation without legacy ledger writes",
    async (mode) => {
      const headers = await signIn(mode);
      const other = await signIn(mode, "bob");
      expect(
        (await models(headers))
          .filter((model) => model.available)
          .map((model) => model.id),
      ).toEqual([verificationModelId]);
      expect(run).not.toHaveBeenCalled();
      const id = await conversation(headers);
      const body = input(id);
      const response = await call(req("/api/chat", headers, body));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"type":"finish"');
      expect(run).toHaveBeenCalledOnce();
      expect(
        await (await call(req("/api/chat", headers, body))).json(),
      ).toEqual({ replayed: true });
      const history = await call(req(`/api/conversations/${id}`, headers));
      expect(
        ((await history.json()) as { messages: unknown[] }).messages,
      ).toHaveLength(2);
      expect((await call(req(`/api/conversations/${id}`, other))).status).toBe(
        404,
      );
      expect(
        (await call(req(`/api/conversations/${id}`, other, {}, "DELETE")))
          .status,
      ).toBe(404);
      expect(
        (await call(req(`/api/conversations/${id}`, headers, {}, "DELETE")))
          .status,
      ).toBe(200);
      expect(
        await (await call(req("/api/ai-verification", headers))).json(),
      ).toEqual({ ready: false, remaining: 0 });
      expect((await ledger()).results).toEqual([]);
      expect(run).toHaveBeenCalledOnce();
    },
  );

  it.each(["access", "better-auth"] as const)(
    "%s: consumed legacy ledger blocks generation and leaves recovery/ownership available",
    async (mode) => {
      const headers = await signIn(mode);
      const other = await signIn(mode, "bob");
      const id = await conversation(headers);
      await seedLedger();
      const before = (await ledger()).results;
      expect((await models(headers)).every((model) => !model.available)).toBe(
        true,
      );
      const response = await call(req("/api/chat", headers, input(id)));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "legacy_verification_ledger",
      });
      expect(
        (await call(req(`/api/conversations/${id}`, headers))).status,
      ).toBe(200);
      expect((await call(req(`/api/conversations/${id}`, other))).status).toBe(
        404,
      );
      expect(
        (await call(req(`/api/conversations/${id}`, headers, {}, "DELETE")))
          .status,
      ).toBe(200);
      expect((await ledger()).results).toEqual(before);
      expect(
        await config.DB.prepare(
          "SELECT count(*) AS n FROM chat_requests",
        ).first(),
      ).toEqual({ n: 0 });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each(["off", "invalid", "invalid-allowlist"])(
    "%s: settings errors do not block Better Auth login, logout or owner CRUD",
    async (state) => {
      config = {
        ...config,
        AI_MODE:
          state === "off"
            ? "off"
            : state === "invalid"
              ? "TEST_ONLY_invalid"
              : "selected",
        AI_ALLOWED_MODELS: state === "off" ? "[]" : "TEST_ONLY_invalid_JSON",
      };
      const headers = await signIn("better-auth");
      const id = await conversation(headers);
      expect((await models(headers)).every((model) => !model.available)).toBe(
        true,
      );
      expect((await call(req("/api/chat", headers, input(id)))).status).toBe(
        503,
      );
      const session = await call(req("/api/session", headers));
      expect(
        (
          (await session.json()) as { identity: Identity }
        ).identity.id.startsWith("better-auth:"),
      ).toBe(true);
      expect(
        (await call(req(`/api/conversations/${id}`, headers))).status,
      ).toBe(200);
      expect(
        (await call(req(`/api/conversations/${id}`, headers, {}, "DELETE")))
          .status,
      ).toBe(200);
      expect((await call(req("/api/auth/sign-out", headers, {}))).status).toBe(
        200,
      );
      expect((await call(req("/api/models", headers))).status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing table with fixed errors and keeps auth/history/logout usable", async () => {
    const headers = await signIn("better-auth");
    const id = await conversation(headers);
    await config.DB.prepare(
      "ALTER TABLE ai_verification RENAME TO b2_test_missing_table",
    ).run();
    try {
      expect((await models(headers)).every((model) => !model.available)).toBe(
        true,
      );
      const response = await call(req("/api/chat", headers, input(id)));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "verification_ledger_unavailable",
      });
      expect(
        (await call(req(`/api/conversations/${id}`, headers))).status,
      ).toBe(200);
      expect(
        (await call(req(`/api/conversations/${id}`, headers, {}, "DELETE")))
          .status,
      ).toBe(200);
      expect((await call(req("/api/auth/sign-out", headers, {}))).status).toBe(
        200,
      );
      expect(run).not.toHaveBeenCalled();
    } finally {
      await config.DB.prepare(
        "ALTER TABLE b2_test_missing_table RENAME TO ai_verification",
      ).run();
    }
  });

  it("fails closed on query errors without exposing the raw error", async () => {
    const headers = await signIn("access");
    const id = await conversation(headers);
    const prepare = config.DB.prepare.bind(config.DB);
    vi.spyOn(config.DB, "prepare").mockImplementation((query) => {
      if (query === ledgerQuery)
        throw new Error("TEST_ONLY_private_database_detail");
      return prepare(query);
    });
    const response = await call(req("/api/chat", headers, input(id)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "verification_ledger_unavailable",
    });
    expect((await models(headers)).every((model) => !model.available)).toBe(
      true,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("checks auth, method, body and ownership before ledger or configuration", async () => {
    const headers = await signIn("access");
    const other = await signIn("access", "bob");
    const id = await conversation(headers);
    await seedLedger();
    config = { ...config, AI_MODE: "TEST_ONLY_invalid" };
    const prepare = vi.spyOn(config.DB, "prepare");
    expect((await call(req("/api/models"))).status).toBe(401);
    expect((await call(req("/api/models", headers, {}))).status).toBe(405);
    expect((await call(req("/api/chat", headers))).status).toBe(405);
    expect((await call(req("/api/chat", headers, {}))).status).toBe(400);
    const text = req("/api/chat", headers, input(id));
    text.headers.set("Content-Type", "text/plain");
    expect((await call(text)).status).toBe(415);
    expect(
      (
        await call(
          req("/api/chat", headers, {
            ...input(id),
            message: "x".repeat(41000),
          }),
        )
      ).status,
    ).toBe(413);
    expect((await call(req("/api/chat", other, input(id)))).status).toBe(404);
    expect(prepare.mock.calls.some(([query]) => query === ledgerQuery)).toBe(
      false,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("never caches an empty ledger; checks only existence, without content or mutations", async () => {
    const prepare = vi.spyOn(config.DB, "prepare");
    await checkRuntimeBoundary(config);
    expect(prepare.mock.calls.map(([query]) => query)).toEqual([ledgerQuery]);
    prepare.mockClear();
    await seedLedger();
    prepare.mockClear();
    await expect(checkRuntimeBoundary(config)).rejects.toMatchObject({
      code: "legacy_verification_ledger",
    });
    expect(prepare.mock.calls.map(([query]) => query)).toEqual([ledgerQuery]);
    expect(run).not.toHaveBeenCalled();
  });

  it("rechecks before reservation after the entry accepted the empty ledger", async () => {
    const headers = await signIn("access");
    const id = await conversation(headers);
    const reserve = chatStore.reserveChat;
    vi.spyOn(chatStore, "reserveChat").mockImplementationOnce(
      async (...args) => {
        await seedLedger();
        return reserve(...args);
      },
    );
    expect((await call(req("/api/chat", headers, input(id)))).status).toBe(503);
    expect(
      await config.DB.prepare(
        "SELECT count(*) AS n FROM chat_requests",
      ).first(),
    ).toEqual({ n: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it("rechecks immediately before inference and retains the accepted failed request", async () => {
    const headers = await signIn("access");
    const id = await conversation(headers);
    const history = chatStore.chatHistory;
    vi.spyOn(chatStore, "chatHistory").mockImplementationOnce(
      async (...args) => {
        const result = await history(...args);
        await seedLedger();
        return result;
      },
    );
    const body = input(id);
    const response = await call(req("/api/chat", headers, body));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      '"code":"request_preparation_failed"',
    );
    expect(
      await config.DB.prepare("SELECT status FROM chat_requests WHERE id=?")
        .bind(body.requestId)
        .first(),
    ).toEqual({ status: "failed" });
    expect(
      await config.DB.prepare(
        "SELECT active_request_id FROM conversations WHERE id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ active_request_id: null });
    expect((await ledger()).results).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("checks invalid policy and residual legacy settings, without using them as recovery guards", async () => {
    const headers = await signIn("access");
    const id = await conversation(headers);
    for (const overrides of [
      { STAGING_POLICY: "TEST_ONLY_unknown" },
      { AI_VERIFICATION_ENABLED: "true" },
      { AI_VERIFICATION_START: "2026-01-01T00:00:00.000Z" },
    ]) {
      const previous = config;
      config = { ...config, ...overrides };
      expect((await models(headers)).every((model) => !model.available)).toBe(
        true,
      );
      expect((await call(req("/api/chat", headers, input(id)))).status).toBe(
        503,
      );
      expect(
        (await call(req(`/api/conversations/${id}`, headers))).status,
      ).toBe(200);
      config = previous;
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps unselected models unavailable and does not make bad Jev settings a chat guard", async () => {
    const headers = await signIn("access");
    const id = await conversation(headers);
    config.OPENAI_API_KEY = "DUMMY_TEST_KEY_NOT_REAL";
    config = { ...config, JEV_MODE: "TEST_ONLY_invalid" };
    expect(
      (await models(headers)).find(
        (model) => model.id === "openai/gpt-4.1-mini",
      )?.available,
    ).toBe(false);
    expect(
      (
        await call(
          req("/api/chat", headers, {
            ...input(id),
            modelId: "openai/gpt-4.1-mini",
          }),
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await call(
          req("/api/chat", headers, { ...input(id), modelId: "unregistered" }),
        )
      ).status,
    ).toBe(400);
    expect(
      await (await call(req("/api/chat", headers, input(id)))).text(),
    ).toContain('"type":"finish"');
    expect(run).toHaveBeenCalledOnce();
  });

  it("uses per-entry guards on standard staging and keeps OFF features closed", async () => {
    const headers = await signIn("access");
    const id = await conversation(headers);
    config.ENABLE_RAG = "true";
    config.ENABLE_AGENT = "true";
    config.ENABLE_IMAGES = "true";
    config.ENABLE_BILLING = "true";
    await seedLedger();
    for (const path of [
      "/api/extensions/images",
      "/api/approvals",
      "/api/notes",
    ])
      expect((await call(req(path, headers))).status).toBe(503);
    expect((await call(req("/api/billing/webhook"))).status).toBe(405);
    expect((await call(req("/api/extensions/workflows"))).status).toBe(404);
    for (const feature of ["rag", "agent"])
      expect(
        (
          await call(
            req("/api/chat", headers, { ...input(id), [feature]: true }),
          )
        ).status,
      ).toBe(503);
    expect(
      await config.DB.prepare(
        "SELECT count(*) AS n FROM chat_requests",
      ).first(),
    ).toEqual({ n: 0 });
    const session = await call(req("/api/session", headers));
    expect(
      ((await session.json()) as { features: Record<string, boolean> }).features
        .images,
    ).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});
