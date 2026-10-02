import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decisionDefinitions,
  decisionLimits,
} from "../src/server/decisions/contracts";
import {
  getDecisionRow,
  reserveDecision,
} from "../src/server/decisions/ledger";
import {
  type DecisionEnv,
  evaluateDecision,
} from "../src/server/decisions/service";
import type { Identity } from "../src/server/env";

const db = env.DB as D1Database;
const alice: Identity = {
  id: "TEST_ONLY_fault_owner",
  email: "fault@example.test",
  name: "Test",
};
const key = (n = 1) =>
  `${new Date().toISOString().slice(0, 10)}:${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const raw = () => ({
  model: "jev-1.13.0",
  answers: {
    intent: {
      type: "choice",
      choice: "none",
      probabilities: { technical: 0, writing: 0, planning: 0, none: 1 },
      confidence: 1,
    },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
});
let config: DecisionEnv;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const run = () =>
  evaluateDecision(
    { env: config, identity: alice, fetcher },
    "starter-intent",
    { input: "TEST_ONLY_input" },
    key(),
  );
beforeEach(async () => {
  await db.prepare("DELETE FROM decision_requests").run();
  await db.prepare("DELETE FROM ai_verification").run();
  config = {
    ...env,
    DB: db,
    APP_ENV: "staging",
    APP_ORIGIN: "https://fault.example.invalid",
    STAGING_POLICY: "standard",
    LOCAL_DEMO: "false",
    JEV_MODE: "remote",
    JEV_MODEL: "jev-1.13.0",
    TYPESAFE_API_KEY: "TEST_ONLY_dummy_key",
    AI_VERIFICATION_ENABLED: "false",
    AI_VERIFICATION_START: "",
  } as DecisionEnv;
  fetcher = vi.fn<typeof fetch>(async () => Response.json(raw()));
});
afterEach(() => vi.restoreAllMocks());
function faultDatabase(
  match: string,
  effect: (statement: D1PreparedStatement) => Promise<D1Result>,
): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
            new Proxy(statement, {
              get(s, p) {
                if (p === "bind")
                  return (...values: unknown[]) => wrap(s.bind(...values));
                if (p === "run" && sql.includes(match)) return () => effect(s);
                const value = Reflect.get(s, p);
                return typeof value === "function" ? value.bind(s) : value;
              },
            });
          return wrap(target.prepare(sql));
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
describe("decision failure stages in real D1", () => {
  it.each([false, true])(
    "claim failure before/after write %# never sends",
    async (after) => {
      config.DB = faultDatabase("SET state='submitting'", async (statement) => {
        if (after) await statement.run();
        throw new Error("TEST_ONLY_claim_fault");
      });
      await expect(run()).rejects.toMatchObject({
        code: "decision_ledger_unavailable",
      });
      expect((await getDecisionRow(db, alice.id, key()))?.state).toBe(
        after ? "submitting" : "reserved",
      );
      await expect(run()).rejects.toMatchObject({ status: 409 });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    "terminal failure before/after write %# prevents200 and replay",
    async (after) => {
      config.DB = faultDatabase(
        "SET state=?,error_code=?",
        async (statement) => {
          if (after) await statement.run();
          throw new Error("TEST_ONLY_terminal_fault");
        },
      );
      await expect(run()).rejects.toMatchObject({
        code: "decision_ledger_unavailable",
      });
      expect((await getDecisionRow(db, alice.id, key()))?.state).toBe(
        after ? "succeeded" : "submitting",
      );
      await expect(run()).rejects.toMatchObject({ status: 409 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("guard after claim prevents fetch while retaining uncertainty", async () => {
    config.DB = faultDatabase("SET state='submitting'", async (statement) => {
      const result = await statement.run();
      Object.assign(config, { JEV_MODEL: "jev-latest" });
      return result;
    });
    await expect(run()).rejects.toMatchObject({ status: 503 });
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe(
      "submission_unknown",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reservation failure rolls back maintenance and never sends", async () => {
    vi.spyOn(db, "batch").mockRejectedValueOnce(
      new Error("TEST_ONLY_batch_fault"),
    );
    await expect(run()).rejects.toMatchObject({
      code: "decision_ledger_unavailable",
    });
    expect(await getDecisionRow(db, alice.id, key())).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("late reservation/claim responses cannot start fetch after the deadline", async () => {
    const original = db.batch.bind(db);
    vi.spyOn(db, "batch").mockImplementationOnce(async (statements) => {
      const result = await original(statements);
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 21000);
      return result;
    });
    await expect(run()).rejects.toMatchObject({
      code: "decision_ledger_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe("reserved");
  });
  it("late upstream reply never returns200 or changes submitting to success", async () => {
    fetcher.mockImplementation(async () => {
      const late = Date.now() + 21000;
      vi.spyOn(Date, "now").mockReturnValue(late);
      return Response.json(raw());
    });
    await expect(run()).rejects.toMatchObject({
      code: "decision_ledger_unavailable",
    });
    vi.restoreAllMocks();
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe(
      "submitting",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounded expired lease backlog fails closed after100 rows", async () => {
    const now = Date.now();
    const created = now - 31000;
    await db.batch(
      Array.from({ length: 101 }, (_, i) =>
        db
          .prepare(
            `INSERT INTO decision_requests(owner_id,request_key,request_day,definition_id,contract_version,model_id,question_count,state,created_at,reservation_until) VALUES (?,?,?,'starter-intent','starter-intent-v1','jev-1.13.0',1,'reserved',?,?)`,
          )
          .bind(
            `TEST_ONLY_expired_${i}`,
            key(i + 1),
            key(i + 1).slice(0, 10),
            created,
            created + 30000,
          ),
      ),
    );
    await expect(run()).rejects.toMatchObject({ status: 429 });
    expect(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM decision_requests WHERE state='failed'",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(100);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["starter-clarity", "starter-request"] as const)(
    "internal %s uses identical admission and fixed transport",
    async (id) => {
      const answers =
        id === "starter-request"
          ? { actionable: { type: "noul", noul: 0.5 } }
          : {
              clarity: {
                type: "score",
                score: 1.5,
                legend: {
                  "0": "目的が読み取れない",
                  "1": "目的は分かるが条件が不足",
                  "2": "目的と条件が明確",
                },
                probabilities: { "0": 0, "1": 0.5, "2": 0.5 },
                confidence: 0.3,
              },
            };
      fetcher.mockResolvedValue(Response.json({ ...raw(), answers }));
      const result = await evaluateDecision(
        { env: config, identity: alice, fetcher },
        id,
        { input: "TEST_ONLY_input" },
        key(),
      );
      expect(result.answers).toEqual(answers);
      await expect(run()).rejects.toMatchObject({ status: 409 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("deadline shorter than saving margin consumes once but remains unsent", async () => {
    await expect(
      evaluateDecision(
        {
          env: config,
          identity: alice,
          fetcher,
          receivedAt: Date.now() - 16000,
        },
        "starter-intent",
        { input: "TEST_ONLY" },
        key(),
      ),
    ).rejects.toMatchObject({ status: 504 });
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stream cut is unknown, complete malformed JSON/UTF8/content type is failed", async () => {
    fetcher.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"model":'));
            c.error(new Error("TEST_ONLY_cut"));
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(run()).rejects.toMatchObject({
      code: "decision_submission_unknown",
    });
    for (const response of [
      new Response("{"),
      new Response(new Uint8Array([0xff]), {
        headers: { "Content-Type": "application/json" },
      }),
      new Response(JSON.stringify(raw()), {
        headers: { "Content-Type": "text/plain" },
      }),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(
        evaluateDecision(
          {
            env: config,
            identity: { ...alice, id: crypto.randomUUID() },
            fetcher,
          },
          "starter-intent",
          { input: "TEST_ONLY" },
          key(),
        ),
      ).rejects.toMatchObject({ code: "decision_invalid_response" });
    }
  });
});
describe("decision migration fresh/upgrade/reapply", () => {
  const bindings = env as unknown as {
    DECISION_MIGRATION_DB: D1Database;
    DECISION_UPGRADE_DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  };
  const migrationDb = bindings.DECISION_MIGRATION_DB;
  it("fresh0001..0007 and reapply preserve metadata; constraints reject inconsistent states", async () => {
    await applyD1Migrations(migrationDb, bindings.TEST_MIGRATIONS);
    await reserveDecision(
      migrationDb,
      alice.id,
      key(),
      decisionDefinitions["starter-intent"],
      Date.now(),
    );
    const row = await getDecisionRow(migrationDb, alice.id, key());
    await applyD1Migrations(migrationDb, bindings.TEST_MIGRATIONS);
    expect(await getDecisionRow(migrationDb, alice.id, key())).toEqual(row);
    await expect(
      migrationDb
        .prepare(
          "UPDATE decision_requests SET state='succeeded' WHERE owner_id=?",
        )
        .bind(alice.id)
        .run(),
    ).rejects.toThrow();
    await expect(
      migrationDb
        .prepare(
          "UPDATE decision_requests SET attempt_count=1 WHERE owner_id=?",
        )
        .bind(alice.id)
        .run(),
    ).rejects.toThrow();
    const columns = await migrationDb
      .prepare("PRAGMA table_info(decision_requests)")
      .all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).toHaveLength(18);
  });
  it("upgrade0006 preserves legacy verification/chat rows and appends only new table", async () => {
    const migrationDb = bindings.DECISION_UPGRADE_DB;
    await applyD1Migrations(migrationDb, bindings.TEST_MIGRATIONS.slice(0, 6));
    await migrationDb
      .prepare(
        "INSERT INTO ai_verification(id,owner_id,started_at,expires_at,attempts) VALUES (1,'TEST_ONLY_existing',0,1800000,2)",
      )
      .run();
    await migrationDb
      .prepare(
        "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES ('TEST_ONLY_conversation','TEST_ONLY_existing','TEST_ONLY_title',1,2)",
      )
      .run();
    await applyD1Migrations(migrationDb, bindings.TEST_MIGRATIONS);
    await applyD1Migrations(migrationDb, bindings.TEST_MIGRATIONS);
    expect(
      await migrationDb
        .prepare("SELECT attempts FROM ai_verification WHERE id=1")
        .first(),
    ).toEqual({ attempts: 2 });
    expect(
      await migrationDb
        .prepare(
          "SELECT title,updated_at FROM conversations WHERE id='TEST_ONLY_conversation'",
        )
        .first(),
    ).toEqual({ title: "TEST_ONLY_title", updated_at: 2 });
    expect(await getDecisionRow(migrationDb, alice.id, key())).toBeNull();
    expect(decisionLimits.retentionMs).toBe(90 * 86400000);
  });
});
