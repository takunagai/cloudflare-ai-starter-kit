import { introspectWorkflowInstance } from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv, Identity } from "../src/server/env";
import { digest } from "../src/server/extensions/rag";
import {
  decideSummary,
  getSummary,
  runSummaryJob,
  type SummaryParams,
  startSummary,
} from "../src/server/extensions/workflows";

const base = env as unknown as AppEnv & { SUMMARY_WORKFLOW: Workflow };
const alice: Identity = {
  id: "workflow-alice",
  email: "alice@example.test",
  name: "Alice",
};
const bob: Identity = {
  id: "workflow-bob",
  email: "bob@example.test",
  name: "Bob",
};
const app = { ...base, ENABLE_WORKFLOWS: "true", LOCAL_DEMO: "true" };

beforeEach(async () => {
  await base.DB.batch([
    base.DB.prepare("DELETE FROM saved_summaries"),
    base.DB.prepare("DELETE FROM summary_jobs"),
  ]);
});

describe("Workflows native local runtime (no paid model)", () => {
  it("runs summary → durable wait → owner approval → one saved result", async () => {
    const requestId = crypto.randomUUID();
    const id = await digest(`summary:${alice.id}:${requestId}`);
    await using monitor = await introspectWorkflowInstance(
      base.SUMMARY_WORKFLOW,
      id,
    );
    const request = {
      requestId,
      model: "local/demo",
      input: "第一章は準備です。第二章は実施です。",
    };
    const job = await startSummary(app, alice, request);
    expect(job.id).toBe(id);
    await monitor.waitForStepResult({ name: "summarize" });
    expect(await getSummary(app, alice, id)).toMatchObject({
      state: "awaiting_approval",
    });
    await expect(decideSummary(app, bob, id, "approve")).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await base.DB.prepare(
        "SELECT COUNT(*) AS count FROM saved_summaries",
      ).first("count"),
    ).toBe(0);
    await decideSummary(app, alice, id, "approve");
    await monitor.waitForStatus("complete");
    expect(await monitor.getOutput()).toEqual({ id, state: "completed" });
    expect(
      await base.DB.prepare(
        "SELECT COUNT(*) AS count FROM saved_summaries WHERE job_id = ?",
      )
        .bind(id)
        .first("count"),
    ).toBe(1);
    expect(await startSummary(app, alice, request)).toMatchObject({
      id,
      state: "completed",
    });
    await expect(
      startSummary(app, alice, { ...request, input: "変更済み" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await decideSummary(app, alice, id, "approve")).toMatchObject({
      state: "completed",
    });
    await expect(decideSummary(app, alice, id, "reject")).rejects.toMatchObject(
      { code: "DECISION_CONFLICT" },
    );
  }, 20_000);

  it("rejects without saving, and a forced native wait timeout expires safely", async () => {
    for (const decision of ["reject", "timeout"] as const) {
      const requestId = crypto.randomUUID();
      const id = await digest(`summary:${alice.id}:${requestId}`);
      await using monitor = await introspectWorkflowInstance(
        base.SUMMARY_WORKFLOW,
        id,
      );
      if (decision === "timeout")
        await monitor.modify(async (m) => {
          await m.forceEventTimeout({ name: "human decision" });
        });
      await startSummary(app, alice, {
        requestId,
        model: "local/demo",
        input: "保存しない文章。",
      });
      await monitor.waitForStepResult({ name: "summarize" });
      if (decision === "reject") await decideSummary(app, alice, id, "reject");
      await monitor.waitForStatus("complete");
      expect(await monitor.getOutput()).toEqual({
        id,
        state: decision === "reject" ? "rejected" : "expired",
      });
    }
    expect(
      await base.DB.prepare(
        "SELECT COUNT(*) AS count FROM saved_summaries",
      ).first("count"),
    ).toBe(0);
  }, 20_000);

  it("retries a transient step error within the configured budget", async () => {
    const requestId = crypto.randomUUID();
    const id = await digest(`summary:${alice.id}:${requestId}`);
    await using monitor = await introspectWorkflowInstance(
      base.SUMMARY_WORKFLOW,
      id,
    );
    await monitor.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "summarize" }, new Error("transient"), 1);
    });
    await startSummary(app, alice, {
      requestId,
      model: "local/demo",
      input: "一時失敗からの復旧。",
    });
    await monitor.waitForStepResult({ name: "summarize" });
    await decideSummary(app, alice, id, "approve");
    await monitor.waitForStatus("complete");
    expect(await monitor.getOutput()).toEqual({ id, state: "completed" });
  }, 20_000);

  it("stops after the retry budget and never saves a failed job", async () => {
    const requestId = crypto.randomUUID();
    const id = await digest(`summary:${alice.id}:${requestId}`);
    await using monitor = await introspectWorkflowInstance(
      base.SUMMARY_WORKFLOW,
      id,
    );
    await monitor.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError(
        { name: "summarize" },
        new Error("fixed test failure"),
      );
    });
    await startSummary(app, alice, {
      requestId,
      model: "local/demo",
      input: "上限まで失敗",
    });
    await monitor.waitForStatus("errored");
    expect(await getSummary(app, alice, id)).toMatchObject({
      state: "failed",
      summary: null,
    });
    expect(
      await base.DB.prepare(
        "SELECT COUNT(*) AS count FROM saved_summaries WHERE job_id = ?",
      )
        .bind(id)
        .first("count"),
    ).toBe(0);
  }, 20_000);
});

describe("SQL side-effect replay and decision transport boundaries", () => {
  it("does not save twice when durable step code is replayed", async () => {
    const id = "a".repeat(64);
    await base.DB.prepare(
      `INSERT INTO summary_jobs (id,owner_id,request_key,input_hash,model,input,state,created_at,updated_at) VALUES (?,?,?,?,?,?,'starting',?,?)`,
    )
      .bind(
        id,
        alice.id,
        crypto.randomUUID(),
        "hash",
        "local/demo",
        "text",
        Date.now(),
        Date.now(),
      )
      .run();
    const summarize = vi.fn(async () => "要約");
    const step = {
      do: async (
        _name: string,
        _config: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
      waitForEvent: async () => {
        await base.DB.prepare(
          "UPDATE summary_jobs SET decision = 'approve' WHERE id = ?",
        )
          .bind(id)
          .run();
        return { payload: {} };
      },
    } as unknown as WorkflowStep;
    const event = {
      payload: { jobId: id },
      instanceId: id,
      timestamp: new Date(),
      workflowName: "summary-test",
    } satisfies WorkflowEvent<SummaryParams>;
    await runSummaryJob(app, event, step, summarize);
    await runSummaryJob(app, event, step, summarize);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(
      await base.DB.prepare(
        "SELECT COUNT(*) AS count FROM saved_summaries WHERE job_id = ?",
      )
        .bind(id)
        .first("count"),
    ).toBe(1);
  });

  it("persists a decision before a delivery failure and permits only its idempotent retry", async () => {
    const id = "b".repeat(64);
    await base.DB.prepare(
      `INSERT INTO summary_jobs (id,owner_id,request_key,input_hash,model,input,state,summary,approval_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'awaiting_approval',?,?,?,?)`,
    )
      .bind(
        id,
        alice.id,
        crypto.randomUUID(),
        "hash",
        "local/demo",
        "text",
        "summary",
        Date.now() + 60_000,
        Date.now(),
        Date.now(),
      )
      .run();
    const sendEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("transport failed"))
      .mockResolvedValue(undefined);
    const fake = {
      ...app,
      SUMMARY_WORKFLOW: {
        get: async () => ({ sendEvent }),
      } as unknown as Workflow,
    };
    await expect(
      decideSummary(fake, alice, id, "approve"),
    ).rejects.toMatchObject({ code: "APPROVAL_DELIVERY_PENDING" });
    await expect(
      decideSummary(fake, alice, id, "reject"),
    ).rejects.toMatchObject({ code: "DECISION_CONFLICT" });
    expect(await decideSummary(fake, alice, id, "approve")).toMatchObject({
      decision: "approve",
    });
    expect(sendEvent).toHaveBeenCalledTimes(2);
  });

  it("rejects expired approval and changed content for the same request ID", async () => {
    const id = "c".repeat(64);
    await base.DB.prepare(
      `INSERT INTO summary_jobs (id,owner_id,request_key,input_hash,model,input,state,summary,approval_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'awaiting_approval',?,?,?,?)`,
    )
      .bind(
        id,
        alice.id,
        crypto.randomUUID(),
        "hash",
        "local/demo",
        "text",
        "summary",
        Date.now() - 1,
        Date.now(),
        Date.now(),
      )
      .run();
    await expect(
      decideSummary(app, alice, id, "approve"),
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
  });
});
