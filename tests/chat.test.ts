import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideNote } from "../src/server/agent-tools";
import { createLocalDemoModel } from "../src/server/ai/local-demo";
import * as providers from "../src/server/ai/providers";
import { handleApp } from "../src/server/app-api";
import { handleAuth } from "../src/server/auth";
import { handleChat } from "../src/server/chat";
import {
  type ChatInput,
  finishChat,
  reserveChat,
} from "../src/server/chat-store";
import type { AppEnv, Identity } from "../src/server/env";

const local = {
  ...env,
  APP_ENV: "local",
  APP_ORIGIN: "http://127.0.0.1:3000",
  AUTH_MODE: "better-auth",
  LOCAL_DEMO: "true",
} as AppEnv;
const alice: Identity = {
  id: "test:alice",
  email: "alice@example.test",
  name: "Alice",
};
const bob: Identity = {
  id: "test:bob",
  email: "bob@example.test",
  name: "Bob",
};
let conversationId: string;
function input(overrides: Partial<ChatInput> = {}): ChatInput {
  return {
    conversationId,
    requestId: crypto.randomUUID(),
    modelId: "local/demo",
    message: "こんにちは",
    rag: false,
    agent: false,
    ...overrides,
  };
}
function req(path: string, body?: unknown, cookie?: string) {
  return new Request(`${local.APP_ORIGIN}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: local.APP_ORIGIN,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  await local.DB.batch([
    local.DB.prepare("DELETE FROM conversations"),
    local.DB.prepare("DELETE FROM chat_requests"),
    local.DB.prepare("DELETE FROM app_rate_limits"),
  ]);
  conversationId = crypto.randomUUID();
  await local.DB.prepare(
    "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES (?,?,?,0,0)",
  )
    .bind(conversationId, alice.id, "test")
    .run();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function partialModel(failImmediately = false) {
  const model = createLocalDemoModel();
  model.doStream = async (options) => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "partial" });
        controller.enqueue({
          type: "text-delta",
          id: "partial",
          delta: "partial answer",
        });
        if (failImmediately) {
          controller.enqueue({
            type: "error",
            error: new Error("dummy-upstream-failure"),
          });
          controller.close();
          return;
        }
        options.abortSignal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      },
    }),
  });
  return model;
}

describe("Chat admission and persistence on D1", () => {
  it("runs an actual SDK tool step but waits for human approval before saving", async () => {
    const enabled = { ...local, ENABLE_AGENT: "true" };
    const ctx = createExecutionContext();
    const response = await handleChat(
      req("/api/chat", input({ agent: true })),
      enabled,
      alice,
      ctx,
    );
    const stream = await response.text();
    await waitOnExecutionContext(ctx);
    expect(stream).toContain('"type":"approval"');
    expect(stream).toContain('"type":"finish"');
    const approval = await local.DB.prepare(
      "SELECT id FROM tool_approvals WHERE owner_id=? AND status='pending'",
    )
      .bind(alice.id)
      .first<{ id: string }>();
    expect(approval).toBeTruthy();
    expect(
      await local.DB.prepare("SELECT id FROM notes WHERE id=?")
        .bind(approval?.id)
        .first(),
    ).toBeNull();
    await decideNote(enabled, alice, approval?.id ?? "", "approve");
    expect(
      await local.DB.prepare("SELECT id FROM notes WHERE id=?")
        .bind(approval?.id)
        .first(),
    ).toBeTruthy();
  });
  it("streams the dummy model, saves the two messages, and replays without generating twice", async () => {
    const body = input();
    const ctx = createExecutionContext();
    const response = await handleChat(
      req("/api/chat", body),
      local,
      alice,
      ctx,
    );
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const stream = await response.text();
    await waitOnExecutionContext(ctx);
    expect(stream).toContain('"type":"delta"');
    expect(stream).toContain('"type":"finish"');
    const messages = await local.DB.prepare(
      "SELECT role,content,status FROM messages ORDER BY created_at",
    ).all<{ role: string; content: string; status: string }>();
    expect(messages.results).toHaveLength(2);
    expect(messages.results.every((row) => row.status === "complete")).toBe(
      true,
    );
    expect(messages.results[0].content).toBe(body.message);
    const repeat = await handleChat(
      req("/api/chat", body),
      local,
      alice,
      createExecutionContext(),
    );
    expect(await repeat.json()).toEqual({ replayed: true });
    expect(
      (
        await local.DB.prepare(
          "SELECT count(*) AS n FROM chat_requests",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
  it("checks ownership before reserving or calling a model", async () => {
    await expect(reserveChat(local, bob, input())).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (
        await local.DB.prepare(
          "SELECT count(*) AS n FROM chat_requests",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
  it("allows only one simultaneous request per user across different conversations", async () => {
    const other = crypto.randomUUID();
    await local.DB.prepare(
      "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES (?,?,?,0,0)",
    )
      .bind(other, alice.id, "second")
      .run();
    const outcomes = await Promise.allSettled([
      reserveChat(local, alice, input()),
      reserveChat(local, alice, input({ conversationId: other })),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
  });
  it("rejects changed input and failed request ID reuse", async () => {
    const body = input();
    await reserveChat(local, alice, body);
    await expect(
      reserveChat(local, alice, { ...body, message: "changed" }),
    ).rejects.toMatchObject({ code: "request_id_conflict" });
    await finishChat(local, alice, body, "partial", "failed");
    await expect(reserveChat(local, alice, body)).rejects.toMatchObject({
      code: "request_already_used",
    });
    expect(await reserveChat(local, alice, input())).toBe(true);
  });
  it("reserves an identical racing request only once", async () => {
    const body = input();
    const results = await Promise.allSettled([
      reserveChat(local, alice, body),
      reserveChat(local, alice, body),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (
        await local.DB.prepare("SELECT count(*) AS n FROM messages").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(2);
  });
  it("enforces the daily cap including failed requests", async () => {
    await local.DB.batch(
      Array.from({ length: 60 }, () =>
        local.DB.prepare(
          "INSERT INTO chat_requests(id,owner_id,conversation_id,model_id,input_hash,status,created_at) VALUES (?,?,?,?,?,'failed',?)",
        ).bind(
          crypto.randomUUID(),
          alice.id,
          conversationId,
          "local/demo",
          "dummy",
          Date.now(),
        ),
      ),
    );
    await expect(reserveChat(local, alice, input())).rejects.toMatchObject({
      code: "quota_or_concurrency_limit",
    });
    await local.DB.prepare("DELETE FROM conversations WHERE id=?")
      .bind(conversationId)
      .run();
    conversationId = crypto.randomUUID();
    await local.DB.prepare(
      "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES (?,?,?,0,0)",
    )
      .bind(conversationId, alice.id, "new after deletion")
      .run();
    await expect(reserveChat(local, alice, input())).rejects.toMatchObject({
      code: "quota_or_concurrency_limit",
    });
  });
  it("recovers an expired lock and marks stale history failed", async () => {
    const old = input();
    await reserveChat(local, alice, old);
    await local.DB.batch([
      local.DB.prepare("UPDATE chat_requests SET created_at=0"),
      local.DB.prepare("UPDATE conversations SET lock_until=0"),
    ]);
    expect(await reserveChat(local, alice, input())).toBe(true);
    expect(
      (
        await local.DB.prepare("SELECT status FROM chat_requests WHERE id=?")
          .bind(old.requestId)
          .first<{ status: string }>()
      )?.status,
    ).toBe("failed");
  });
  it("rejects unavailable models and disabled extensions before consuming quota", async () => {
    for (const body of [
      input({ modelId: "untrusted/model" }),
      input({ rag: true }),
      input({ agent: true }),
    ]) {
      await expect(
        handleChat(
          req("/api/chat", body),
          local,
          alice,
          createExecutionContext(),
        ),
      ).rejects.toMatchObject({ status: expect.any(Number) });
    }
    expect(
      (
        await local.DB.prepare(
          "SELECT count(*) AS n FROM chat_requests",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
  it("aborts a pre-cancelled request and records cancelled history", async () => {
    const abort = new AbortController();
    abort.abort();
    const request = new Request(req("/api/chat", input()), {
      signal: abort.signal,
    });
    const ctx = createExecutionContext();
    const response = await handleChat(request, local, alice, ctx);
    await response.text();
    await waitOnExecutionContext(ctx);
    expect(
      (
        await local.DB.prepare("SELECT status FROM chat_requests").first<{
          status: string;
        }>()
      )?.status,
    ).toBe("cancelled");
  });
  it("does not expose a provider error and releases the lock after failure", async () => {
    const broken = createLocalDemoModel();
    broken.doStream = async () => {
      throw new Error("test-only-private-provider-detail");
    };
    vi.spyOn(providers, "getModel").mockReturnValue(broken);
    const ctx = createExecutionContext();
    const response = await handleChat(
      req("/api/chat", input()),
      local,
      alice,
      ctx,
    );
    const stream = await response.text();
    await waitOnExecutionContext(ctx);
    expect(stream).toContain('"code":"generation_failed"');
    expect(stream.includes("test-only-private-provider-detail")).toBe(false);
    expect(
      (
        await local.DB.prepare("SELECT status FROM chat_requests").first<{
          status: string;
        }>()
      )?.status,
    ).toBe("failed");
    expect(
      (
        await local.DB.prepare(
          "SELECT active_request_id FROM conversations",
        ).first<{ active_request_id: string | null }>()
      )?.active_request_id,
    ).toBeNull();
  });
  it("persists a partial answer when the browser cancels reading mid-stream", async () => {
    vi.spyOn(providers, "getModel").mockReturnValue(partialModel());
    const ctx = createExecutionContext();
    const response = await handleChat(
      req("/api/chat", input()),
      local,
      alice,
      ctx,
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    for (;;) {
      const part = await reader?.read();
      if (
        part?.value &&
        new TextDecoder().decode(part.value).includes('"type":"delta"')
      )
        break;
    }
    await reader?.cancel();
    await waitOnExecutionContext(ctx);
    const saved = await local.DB.prepare(
      "SELECT content,status FROM messages WHERE role='assistant'",
    ).first<{ content: string; status: string }>();
    expect(saved).toEqual({ content: "partial answer", status: "cancelled" });
  });
  it("persists a partial answer when the provider fails mid-stream", async () => {
    vi.spyOn(providers, "getModel").mockReturnValue(partialModel(true));
    const ctx = createExecutionContext();
    const response = await handleChat(
      req("/api/chat", input()),
      local,
      alice,
      ctx,
    );
    const text = await response.text();
    await waitOnExecutionContext(ctx);
    expect(text.includes("dummy-upstream-failure")).toBe(false);
    expect(
      await local.DB.prepare(
        "SELECT content,status FROM messages WHERE role='assistant'",
      ).first(),
    ).toEqual({ content: "partial answer", status: "failed" });
  });
  it("aborts stalled inference at the 60 second deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(providers, "getModel").mockReturnValue(partialModel());
    const ctx = createExecutionContext();
    const response = await handleChat(
      req("/api/chat", input()),
      local,
      alice,
      ctx,
    );
    const reader = response.body?.getReader();
    for (;;) {
      const part = await reader?.read();
      if (
        part?.value &&
        new TextDecoder().decode(part.value).includes('"type":"delta"')
      )
        break;
    }
    await vi.advanceTimersByTimeAsync(60001);
    for (;;) {
      const part = await reader?.read();
      if (part?.done) break;
    }
    await waitOnExecutionContext(ctx);
    expect(
      (
        await local.DB.prepare("SELECT status FROM chat_requests").first<{
          status: string;
        }>()
      )?.status,
    ).toBe("failed");
  });
});

describe("Authenticated app API", () => {
  it("blocks anonymous and wrong-origin mutations", async () => {
    expect(
      (await handleApp(req("/api/models"), local, createExecutionContext()))
        .status,
    ).toBe(401);
    const request = req("/api/conversations", { title: "test" });
    request.headers.set("Origin", "https://attacker.test");
    expect(
      (await handleApp(request, local, createExecutionContext())).status,
    ).toBe(403);
  });
  it("rejects local auth/demo configuration on a public host", async () => {
    expect(
      (
        await handleApp(
          new Request("https://public.test/api/session"),
          local,
          createExecutionContext(),
        )
      ).status,
    ).toBe(503);
  });
  it("connects signup, private CRUD, chat and history without disclosing another user's records", async () => {
    const signup = await handleAuth(
      req("/api/auth/sign-up/email", {
        name: "Test",
        email: `${crypto.randomUUID()}@example.test`,
        password: "test-only-password-2026",
      }),
      local,
    );
    expect(signup.status).toBe(200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const created = await handleApp(
      req("/api/conversations", { title: "my chat" }, cookie),
      local,
      createExecutionContext(),
    );
    const { conversation } = (await created.json()) as {
      conversation: { id: string };
    };
    expect(created.status).toBe(201);
    const ctx = createExecutionContext();
    const response = await handleApp(
      req("/api/chat", input({ conversationId: conversation.id }), cookie),
      local,
      ctx,
    );
    expect(response.status).toBe(200);
    await response.text();
    await waitOnExecutionContext(ctx);
    const result = await handleApp(
      req(`/api/conversations/${conversation.id}`, undefined, cookie),
      local,
      createExecutionContext(),
    );
    expect(
      ((await result.json()) as { messages: unknown[] }).messages,
    ).toHaveLength(2);
    expect(
      (
        await handleApp(
          req(`/api/conversations/${conversationId}`, undefined, cookie),
          local,
          createExecutionContext(),
        )
      ).status,
    ).toBe(404);
    const deleted = await handleApp(
      new Request(req(`/api/conversations/${conversation.id}`, {}, cookie), {
        method: "DELETE",
      }),
      local,
      createExecutionContext(),
    );
    expect(deleted.status).toBe(200);
    expect(
      (
        await local.DB.prepare(
          "SELECT count(*) AS n FROM messages WHERE conversation_id=?",
        )
          .bind(conversation.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
    expect(
      (
        await local.DB.prepare(
          "SELECT count(*) AS n FROM chat_requests WHERE conversation_id IS NULL",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
});
