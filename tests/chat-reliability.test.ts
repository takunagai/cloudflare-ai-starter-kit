import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalDemoModel } from "../src/server/ai/local-demo";
import * as providers from "../src/server/ai/providers";
import { handleChat } from "../src/server/chat";
import * as store from "../src/server/chat-store";
import {
  type ChatInput,
  chatRequestStatus,
  reserveChat,
} from "../src/server/chat-store";
import type { AppEnv, Identity } from "../src/server/env";

const base = {
  ...env,
  APP_ENV: "local",
  APP_ORIGIN: "http://127.0.0.1:3000",
  AUTH_MODE: "better-auth",
  LOCAL_DEMO: "true",
} as AppEnv;
const owner: Identity = {
  id: "recovery-owner",
  name: "Owner",
  email: "owner@example.test",
};
let input: ChatInput;
beforeEach(async () => {
  await base.DB.batch([
    base.DB.prepare("DELETE FROM conversations"),
    base.DB.prepare("DELETE FROM chat_requests"),
    base.DB.prepare("DELETE FROM app_rate_limits"),
  ]);
  input = {
    conversationId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    modelId: "local/demo",
    message: "架空資料館の休館日は？",
    rag: false,
    agent: false,
  };
  await base.DB.prepare(
    "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES (?,?,?,0,0)",
  )
    .bind(input.conversationId, owner.id, "架空試験")
    .run();
});
afterEach(() => vi.restoreAllMocks());
function request() {
  return new Request(`${base.APP_ORIGIN}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
async function run(application = base) {
  const context = createExecutionContext();
  const response = await handleChat(request(), application, owner, context);
  const text = await response.text();
  await waitOnExecutionContext(context);
  return text;
}
describe("要求台帳による再送と履歴復元", () => {
  it("推論前の準備失敗はモデルを呼ばず、台帳に再送可能な失敗を残す", async () => {
    const getModel = vi.spyOn(providers, "getModel");
    vi.spyOn(store, "chatHistory").mockRejectedValue(
      new Error("private database detail"),
    );
    const text = await run();
    expect(text).toContain('"code":"history_read_failed"');
    expect(text).not.toContain("private database detail");
    expect(getModel).not.toHaveBeenCalled();
    expect(await chatRequestStatus(base, owner, input.requestId)).toMatchObject(
      {
        status: "failed",
        failureCode: "history_read_failed",
        inference: "not_started",
        canRetry: true,
      },
    );
    await expect(run()).rejects.toMatchObject({ code: "request_already_used" });
    expect(getModel).not.toHaveBeenCalled();
  });
  it("成功後の応答消失を台帳で照合でき、同じIDの再送はモデルを再実行しない", async () => {
    const model = createLocalDemoModel();
    const calls = vi.spyOn(model, "doStream");
    vi.spyOn(providers, "getModel").mockReturnValue(model);
    await run();
    expect(await chatRequestStatus(base, owner, input.requestId)).toMatchObject(
      {
        status: "complete",
        conversationId: input.conversationId,
        canRetry: false,
      },
    );
    expect(await run()).toContain('"replayed":true');
    expect(calls).toHaveBeenCalledTimes(1);
    const history = await base.DB.prepare(
      "SELECT role,content,status FROM messages WHERE request_id=?",
    )
      .bind(input.requestId)
      .all();
    expect(history.results).toHaveLength(2);
    expect(
      history.results.every((message) => message.status === "complete"),
    ).toBe(true);
  });
  it("推論中の通信断は課金不明として扱い、同じIDを再実行しない", async () => {
    const model = createLocalDemoModel();
    model.doStream = vi.fn(async () => {
      throw new Error("private provider failure");
    });
    vi.spyOn(providers, "getModel").mockReturnValue(model);
    const text = await run();
    expect(text).toContain("generation_failed");
    expect(text).not.toContain("private provider failure");
    expect(await chatRequestStatus(base, owner, input.requestId)).toMatchObject(
      { status: "failed", inference: "may_have_run", canRetry: false },
    );
    await expect(run()).rejects.toMatchObject({ code: "request_already_used" });
    expect(model.doStream).toHaveBeenCalledTimes(1);
  });
  it("履歴保存失敗でも推論開始印を失わず、再生成を止める", async () => {
    const model = createLocalDemoModel();
    const calls = vi.spyOn(model, "doStream");
    vi.spyOn(providers, "getModel").mockReturnValue(model);
    vi.spyOn(store, "finishChat").mockRejectedValue(
      new Error("private database detail"),
    );
    const text = await run();
    expect(text).toContain("history_save_failed");
    expect(text).not.toContain("private database detail");
    expect(await chatRequestStatus(base, owner, input.requestId)).toMatchObject(
      {
        status: "pending",
        inference: "may_have_run",
        failureCode: "history_save_failed",
        canRetry: false,
      },
    );
    await expect(run()).rejects.toMatchObject({ code: "request_in_progress" });
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it("古いpendingと既存NULL台帳は推論なしと断定せず、他所有者には返さない", async () => {
    await reserveChat(base, owner, input);
    await base.DB.prepare(
      "UPDATE chat_requests SET created_at=0,inference_started=NULL WHERE id=?",
    )
      .bind(input.requestId)
      .run();
    expect(await chatRequestStatus(base, owner, input.requestId)).toMatchObject(
      { status: "unknown", inference: "unknown", canRetry: false },
    );
    await expect(
      chatRequestStatus(base, { ...owner, id: "other" }, input.requestId),
    ).rejects.toMatchObject({ code: "request_not_found" });
  });
});
