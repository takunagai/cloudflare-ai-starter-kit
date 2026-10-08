import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env as testBindings } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listModels } from "../src/server/ai/providers";
import {
  type VerificationEnv,
  verificationModelId,
  verificationStatus,
} from "../src/server/ai-verification";
import api from "../src/server/api";
import { handleApp } from "../src/server/app-api";
import * as auth from "../src/server/auth";
import { handleChat } from "../src/server/chat";
import * as chatStore from "../src/server/chat-store";
import {
  type ChatInput,
  finishChat,
  reserveChat,
} from "../src/server/chat-store";

const startedAt = Date.parse("2026-09-28T23:50:00.000Z");
const owner = {
  id: "test:verification-owner",
  name: "Test Owner",
  email: "owner@example.test",
};
const other = {
  id: "test:other-owner",
  name: "Other",
  email: "other@example.test",
};
let config: VerificationEnv;
let run: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(startedAt);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("network_forbidden");
    }),
  );
  run = vi.fn(async () => ({
    response: "test answer",
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  }));
  config = {
    ...testBindings,
    APP_ENV: "staging",
    APP_ORIGIN: "https://staging.example.invalid",
    AUTH_MODE: "access",
    AI: { run } as unknown as Ai,
    AI_VERIFICATION_ENABLED: "true",
    AI_VERIFICATION_START: new Date(startedAt).toISOString(),
    LOCAL_DEMO: "false",
    ENABLE_RAG: "false",
    ENABLE_AGENT: "false",
    ENABLE_WORKFLOWS: "false",
    ENABLE_IMAGES: "false",
    ENABLE_BILLING: "false",
  } as VerificationEnv;
  await config.DB.batch([
    config.DB.prepare("DELETE FROM conversations"),
    config.DB.prepare("DELETE FROM chat_requests"),
    config.DB.prepare("DELETE FROM app_rate_limits"),
    config.DB.prepare("DELETE FROM ai_verification"),
  ]);
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function input(
  overrides: Partial<ChatInput> = {},
  identity = owner,
): Promise<ChatInput> {
  const id = crypto.randomUUID();
  await config.DB.prepare(
    "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
  )
    .bind(id, identity.id, "Synthetic test", Date.now(), Date.now())
    .run();
  return {
    conversationId: id,
    requestId: crypto.randomUUID(),
    modelId: verificationModelId,
    message: "test",
    rag: false,
    agent: false,
    ...overrides,
  };
}
function request(path: string, body?: unknown, signal?: AbortSignal) {
  return new Request(config.APP_ORIGIN + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: config.APP_ORIGIN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}
async function chat(value: ChatInput, signal?: AbortSignal) {
  const ctx = createExecutionContext();
  const response = await handleChat(
    request("/api/chat", value, signal),
    config,
    owner,
    ctx,
  );
  const body = await response.text();
  await waitOnExecutionContext(ctx);
  return body;
}
async function attempts() {
  return (
    (
      await config.DB.prepare(
        "SELECT attempts FROM ai_verification WHERE id=1",
      ).first<{ attempts: number }>()
    )?.attempts ?? 0
  );
}

describe("staging verification admission and upstream boundary", () => {
  it("routes authenticated status through the API entry without spending a slot", async () => {
    vi.spyOn(auth, "getIdentity").mockResolvedValue(owner);
    const ctx = createExecutionContext();
    const response = await api.fetch(
      request("/api/ai-verification"),
      config,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ready: true,
      remaining: 3,
      expiresAt: startedAt + 30 * 60000,
    });
    expect(
      await config.DB.prepare(
        "SELECT count(*) AS count FROM ai_verification",
      ).first(),
    ).toEqual({ count: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps authentication, method and disabled checks on the status entry", async () => {
    const identity = vi.spyOn(auth, "getIdentity").mockResolvedValue(null);
    const ctx = createExecutionContext();
    const unauthenticated = await api.fetch(
      request("/api/ai-verification"),
      config,
      ctx,
    );
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({
      error: "authentication_required",
    });
    identity.mockResolvedValue(owner);
    const wrongMethod = await api.fetch(
      request("/api/ai-verification", {}),
      config,
      ctx,
    );
    expect(wrongMethod.status).toBe(405);
    const disabledConfig: VerificationEnv = {
      ...config,
      AI_VERIFICATION_ENABLED: "false",
      AI_VERIFICATION_START: "",
      AI: undefined,
    };
    const disabled = await api.fetch(
      request("/api/ai-verification"),
      disabledConfig,
      ctx,
    );
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ ready: false, remaining: 0 });
    await waitOnExecutionContext(ctx);
    expect(run).not.toHaveBeenCalled();
  });

  it("limits the whole database to three attempts across midnight and deletion", async () => {
    for (let i = 0; i < 3; i++) {
      const value = await input();
      expect(await chat(value)).toContain('"type":"finish"');
      await config.DB.prepare("DELETE FROM conversations WHERE id=?")
        .bind(value.conversationId)
        .run();
      vi.setSystemTime(startedAt + (i + 1) * 6 * 60000);
    }
    expect(await attempts()).toBe(3);
    await expect(chat(await input())).rejects.toMatchObject({ status: 429 });
    expect(run).toHaveBeenCalledTimes(3);
    expect(await verificationStatus(config, owner.id)).toMatchObject({
      ready: false,
      remaining: 0,
    });
    for (const call of run.mock.calls) {
      expect(call[0]).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
      expect(call[1]).toMatchObject({ max_tokens: 1024, stream: true });
    }
  });

  it("admits only one of four concurrent reservations", async () => {
    const values = await Promise.all(Array.from({ length: 4 }, () => input()));
    const results = await Promise.allSettled(
      values.map((value) => reserveChat(config, owner, value)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await attempts()).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("admits only the third slot when two attempts are already spent", async () => {
    for (let i = 0; i < 2; i++) {
      const value = await input();
      await reserveChat(config, owner, value);
      await finishChat(config, owner, value, "", "failed");
    }
    const values = await Promise.all(Array.from({ length: 4 }, () => input()));
    const results = await Promise.allSettled(
      values.map((value) => reserveChat(config, owner, value)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await attempts()).toBe(3);
  });

  it("charges one slot for concurrent duplicate request IDs", async () => {
    const value = await input();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => reserveChat(config, owner, value)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await attempts()).toBe(1);
    expect(
      await config.DB.prepare("SELECT count(*) AS count FROM messages").first(),
    ).toEqual({ count: 2 });
    expect(run).not.toHaveBeenCalled();
  });

  it("rolls back the allowance and lock when message insertion fails", async () => {
    const value = await input();
    await config.DB.prepare(
      "CREATE TRIGGER verification_test_failure BEFORE INSERT ON messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END",
    ).run();
    try {
      await expect(reserveChat(config, owner, value)).rejects.toBeDefined();
      expect(await attempts()).toBe(0);
      expect(
        await config.DB.prepare(
          "SELECT count(*) AS count FROM chat_requests",
        ).first(),
      ).toEqual({ count: 0 });
      expect(
        await config.DB.prepare(
          "SELECT count(*) AS count FROM messages",
        ).first(),
      ).toEqual({ count: 0 });
      expect(
        await config.DB.prepare(
          "SELECT active_request_id FROM conversations WHERE id=?",
        )
          .bind(value.conversationId)
          .first(),
      ).toEqual({ active_request_id: null });
    } finally {
      await config.DB.prepare("DROP TRIGGER verification_test_failure").run();
    }
    expect(await chat(value)).toContain('"type":"finish"');
    expect(await attempts()).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("spends the reservation but never calls upstream if history loading crosses expiry", async () => {
    const original = chatStore.chatHistory;
    vi.spyOn(chatStore, "chatHistory").mockImplementationOnce(
      async (...args) => {
        const history = await original(...args);
        vi.setSystemTime(startedAt + 30 * 60000);
        return history;
      },
    );
    expect(await chat(await input())).toContain(
      '"code":"request_preparation_failed"',
    );
    expect(await attempts()).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses failed history instead of omitting it on a new request", async () => {
    const value = await input();
    run.mockRejectedValueOnce(new Error("synthetic-provider-error"));
    await chat(value);
    expect(await chat({ ...value, requestId: crypto.randomUUID() })).toContain(
      '"code":"history_read_failed"',
    );
    expect(await attempts()).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not reset the owner or window when configuration is reapplied", async () => {
    const value = await input();
    await reserveChat(config, owner, value);
    await finishChat(config, owner, value, "", "failed");
    vi.setSystemTime(startedAt + 60000);
    const changed = {
      ...config,
      AI_VERIFICATION_START: new Date(Date.now()).toISOString(),
    };
    await expect(
      reserveChat(changed, owner, await input()),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      reserveChat(config, other, await input({}, other)),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      reserveChat(
        { ...config, AI_VERIFICATION_ENABLED: "false" },
        owner,
        await input(),
      ),
    ).rejects.toMatchObject({ status: 503 });
    await reserveChat({ ...config }, owner, await input());
    expect(await attempts()).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not refund failed or cancelled calls and does not retry the provider", async () => {
    run.mockRejectedValueOnce(new Error("synthetic-provider-error"));
    expect(await chat(await input())).toContain('"code":"generation_failed"');
    const abort = new AbortController();
    abort.abort();
    expect(await chat(await input(), abort.signal)).toContain(
      '"code":"generation_cancelled"',
    );
    expect(await attempts()).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("replays the same completed input without spending or calling again", async () => {
    const value = await input();
    await chat(value);
    expect(await chat(value)).toBe('{"replayed":true}');
    expect(run).toHaveBeenCalledTimes(1);
    expect(await attempts()).toBe(1);
  });

  it("rejects other models, long messages and extensions before reservation", async () => {
    for (const override of [
      { modelId: "workers-ai/llama-3.1-8b" },
      { modelId: "openai/gpt-4.1-mini" },
      { message: "x".repeat(201) },
      { rag: true },
      { agent: true },
    ]) {
      await expect(chat(await input(override))).rejects.toBeDefined();
    }
    expect(await attempts()).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(
      listModels({ ...config, OPENAI_API_KEY: "DUMMY_TEST_KEY_NOT_REAL" })
        .filter((model) => model.available)
        .map((model) => model.id),
    ).toEqual([verificationModelId]);
  });

  it("sends the two complete history entries but refuses a third turn", async () => {
    const value = await input();
    await chat(value);
    const second = {
      ...value,
      requestId: crypto.randomUUID(),
      message: "follow-up",
    };
    expect(await chat(second)).toContain('"type":"finish"');
    expect(
      run.mock.calls[1][1].messages.map(
        (message: { role: string }) => message.role,
      ),
    ).toEqual(["system", "user", "assistant", "user"]);
    expect(await chat({ ...second, requestId: crypto.randomUUID() })).toContain(
      '"code":"history_read_failed"',
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(await attempts()).toBe(3);
  });

  it("refuses oversized persisted history without silently dropping it", async () => {
    run.mockResolvedValueOnce({ response: "玉".repeat(1500) });
    const value = await input();
    await chat(value);
    expect(await chat({ ...value, requestId: crypto.randomUUID() })).toContain(
      '"code":"history_read_failed"',
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(await attempts()).toBe(2);
  });

  it("refuses conversations from before the fixed window", async () => {
    const value = await input();
    await config.DB.prepare("UPDATE conversations SET created_at=? WHERE id=?")
      .bind(startedAt - 1, value.conversationId)
      .run();
    await expect(chat(value)).rejects.toMatchObject({ status: 429 });
    expect(await attempts()).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed at expiry without calling a binding", async () => {
    vi.setSystemTime(startedAt + 30 * 60000);
    await expect(chat(await input())).rejects.toMatchObject({ status: 403 });
    expect(run).not.toHaveBeenCalled();
    expect(await attempts()).toBe(0);
  });

  it.each([60000, 1000])(
    "aborts the binding at the earlier timeout or window deadline (%i ms)",
    async (remaining) => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(startedAt + 30 * 60000 - remaining);
      let upstreamSignal: AbortSignal | undefined;
      let started: () => void = () => {};
      const upstreamStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      run.mockImplementationOnce(
        (_model, _input, options: { signal: AbortSignal }) => {
          upstreamSignal = options.signal;
          started();
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        },
      );
      const value = await input();
      const response = chat(value);
      await upstreamStarted;
      await vi.advanceTimersByTimeAsync(remaining - 1);
      expect(upstreamSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await response).toContain('"code":"generation_timeout"');
      expect(upstreamSignal?.aborted).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      expect(await attempts()).toBe(1);
    },
  );

  it("keeps the attempt charged when a stale reservation is recovered", async () => {
    const value = await input();
    await reserveChat(config, owner, value);
    vi.setSystemTime(startedAt + 120001);
    expect(await chat(await input())).toContain('"type":"finish"');
    expect(await attempts()).toBe(2);
    expect(
      await config.DB.prepare("SELECT status FROM chat_requests WHERE id=?")
        .bind(value.requestId)
        .first(),
    ).toMatchObject({ status: "failed" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("requires authentication for status and blocks extension and billing routes", async () => {
    const identity = vi.spyOn(auth, "getIdentity").mockResolvedValue(null);
    expect(
      (
        await handleApp(
          request("/api/ai-verification"),
          config,
          createExecutionContext(),
        )
      ).status,
    ).toBe(401);
    identity.mockResolvedValue(owner);
    const response = await handleApp(
      request("/api/ai-verification"),
      config,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({ ready: true, remaining: 3 });
    for (const path of [
      "/api/extensions/images",
      "/api/extensions/workflows",
      "/api/billing/webhook",
      "/api/approvals",
      "/api/notes",
    ]) {
      expect(
        (
          await handleApp(
            request(path),
            { ...config, ENABLE_IMAGES: "true", ENABLE_BILLING: "true" },
            createExecutionContext(),
          )
        ).status,
      ).toBe(404);
    }
    expect(run).not.toHaveBeenCalled();
  });
});
