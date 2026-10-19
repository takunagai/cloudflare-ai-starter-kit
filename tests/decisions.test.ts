import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../src/server/api";
import * as auth from "../src/server/auth";
import { fetchDecision } from "../src/server/decisions/adapter";
import {
  classifySchema,
  decisionDefinitions,
  decisionLimits,
  inputSchema,
  serializePayload,
  validateDecisionResponse,
  validRequestKey,
} from "../src/server/decisions/contracts";
import {
  claimDecision,
  finishDecision,
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
  id: "TEST_ONLY_decision_alice",
  email: "alice@example.test",
  name: "Alice",
};
const bob: Identity = {
  id: "TEST_ONLY_decision_bob",
  email: "bob@example.test",
  name: "Bob",
};
const def = decisionDefinitions["starter-intent"];
const day = () => new Date().toISOString().slice(0, 10);
const key = (n = 1, date = day()) =>
  `${date}:${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const input = { input: "来週の準備を順番に整理したい" };
const fixture = () => ({
  model: "jev-1.13.0",
  answers: {
    intent: {
      type: "choice",
      choice: "planning",
      probabilities: {
        technical: 0.05,
        writing: 0.1,
        planning: 0.7,
        none: 0.15,
      },
      confidence: 0.4,
    },
  },
  usage: { input_tokens: 320, output_tokens: 40 },
});
let config: { -readonly [K in keyof DecisionEnv]: DecisionEnv[K] };
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const evaluate = (
  n = 1,
  identity = alice,
  receivedAt?: number,
  signal?: AbortSignal,
) =>
  evaluateDecision(
    { env: config, identity, fetcher, receivedAt, signal },
    "starter-intent",
    input,
    key(n),
  );
beforeEach(async () => {
  await db.prepare("DELETE FROM decision_requests").run();
  await db.prepare("DELETE FROM ai_verification").run();
  await db.prepare("DELETE FROM app_rate_limits").run();
  config = {
    ...env,
    DB: db,
    APP_ENV: "staging",
    APP_ORIGIN: "https://decision.example.invalid",
    STAGING_POLICY: "standard",
    LOCAL_DEMO: "false",
    AI_MODE: "invalid",
    JEV_MODE: "remote",
    JEV_MODEL: "jev-1.13.0",
    TYPESAFE_API_KEY: "TEST_ONLY_dummy_key",
    AI_VERIFICATION_ENABLED: "false",
    AI_VERIFICATION_START: "",
  } as DecisionEnv;
  fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture()));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function seed(
  owner: string,
  n: number,
  createdAt: number,
  state = "failed",
) {
  const k = key(n, new Date(createdAt).toISOString().slice(0, 10));
  await db
    .prepare(`INSERT INTO decision_requests(owner_id,request_key,request_day,definition_id,contract_version,model_id,question_count,state,error_code,created_at,reservation_until,finished_at,expires_at)
    VALUES (?,?,?,'starter-intent','starter-intent-v1','jev-1.13.0',1,?,?, ?,?,?,?)`)
    .bind(
      owner,
      k,
      k.slice(0, 10),
      state,
      state === "failed" ? "decision_guard_rejected" : null,
      createdAt,
      createdAt + 30000,
      state === "failed" ? createdAt : null,
      state === "failed" ? createdAt + decisionLimits.retentionMs : null,
    )
    .run();
  return k;
}

describe("Jev contract and projected responses", () => {
  it.each(["", " ", "\0", "\ud800", "\udfff", "a".repeat(2001)])(
    "input rejects invalid text %#",
    (s) => expect(inputSchema.safeParse({ input: s }).success).toBe(false),
  );
  it.each(["a".repeat(2000), "あ".repeat(2000), "😀".repeat(2000), " 目的 "])(
    "code points/UTF8 preserve accepted input %#",
    (s) => expect(inputSchema.parse({ input: s }).input).toBe(s),
  );
  it("strict keys and actual calendar dates", () => {
    expect(
      classifySchema.safeParse({ ...input, requestKey: key(), owner: alice.id })
        .success,
    ).toBe(false);
    expect(validRequestKey(key(1, "2026-02-29"))).toBe(false);
    expect(validRequestKey(key(1, "2028-02-29"))).toBe(true);
    expect(validRequestKey(key(0xab).toUpperCase())).toBe(false);
  });
  it("state size/depth, data URI and payload budget", () => {
    expect(() => serializePayload(def, { input: "😀".repeat(2000) })).toThrow(
      "invalid_input",
    );
    expect(() =>
      serializePayload(def, { a: { b: { c: { d: { e: "x" } } } } }),
    ).toThrow("invalid_input");
    expect(() =>
      serializePayload(def, "data:image/png;base64,TEST_ONLY"),
    ).toThrow("invalid_input");
    expect(() => serializePayload({ ...def, questions: {} }, input)).toThrow(
      "invalid_input",
    );
    expect(() =>
      serializePayload(
        {
          ...def,
          questions: {
            invalid: { type: "score", instructions: "test", criteria: ["one"] },
          },
        },
        input,
      ),
    ).toThrow("invalid_input");
    const payload = JSON.parse(serializePayload(def, input));
    expect(payload).toEqual({
      model: "jev-1.13.0",
      state: input,
      questions: def.questions,
    });
  });
  it("projects unknown fields without recomputing confidence", () => {
    const raw = fixture();
    Object.assign(raw, { raw: "TEST_ONLY_ignored" });
    Object.assign(raw.answers.intent, { hidden: "TEST_ONLY_ignored" });
    const result = validateDecisionResponse(raw, def);
    expect(result.answers.intent).toEqual(fixture().answers.intent);
    expect(result.usage).toEqual({ inputTokens: 320, outputTokens: 40 });
  });
  it.each([
    (v: ReturnType<typeof fixture>) => {
      v.model = "jev-latest";
    },
    (v: ReturnType<typeof fixture>) => {
      v.answers.intent.choice = "technical";
    },
    (v: ReturnType<typeof fixture>) => {
      v.answers.intent.probabilities.none = 0.2;
    },
    (v: ReturnType<typeof fixture>) => {
      v.answers.intent.confidence = NaN;
    },
    (v: ReturnType<typeof fixture>) => {
      v.usage.input_tokens = -1;
    },
    (v: ReturnType<typeof fixture>) => {
      v.usage.output_tokens = Number.MAX_SAFE_INTEGER + 1;
    },
    (v: ReturnType<typeof fixture>) => {
      Object.assign(v.answers, { extra: v.answers.intent });
    },
    (v: ReturnType<typeof fixture>) => {
      Reflect.deleteProperty(v.answers, "intent");
    },
    (v: ReturnType<typeof fixture>) => {
      Reflect.deleteProperty(v.answers.intent.probabilities, "none");
    },
    (v: ReturnType<typeof fixture>) => {
      Object.assign(v.answers.intent.probabilities, { extra: 0 });
    },
  ])("rejects response mismatch %#", (mutate) => {
    const raw = fixture();
    mutate(raw);
    expect(() => validateDecisionResponse(raw, def)).toThrow(
      "decision_invalid_response",
    );
  });
  it("Score validates legend, average and fractional value; Noul strips confidence", () => {
    const scoreDef = decisionDefinitions["starter-clarity"];
    const score = {
      type: "score",
      score: 1.5,
      legend: {
        "0": "目的が読み取れない",
        "1": "目的は分かるが条件が不足",
        "2": "目的と条件が明確",
      },
      probabilities: { "0": 0, "1": 0.5, "2": 0.5 },
      confidence: 0.25,
    };
    const raw = {
      model: "jev-1.13.0",
      answers: { clarity: score },
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    expect(validateDecisionResponse(raw, scoreDef).answers.clarity).toEqual(
      score,
    );
    expect(() =>
      validateDecisionResponse(
        { ...raw, answers: { clarity: { ...score, score: 1.6 } } },
        scoreDef,
      ),
    ).toThrow();
    expect(() =>
      validateDecisionResponse(
        {
          ...raw,
          answers: {
            clarity: { ...score, legend: { ...score.legend, "0": "other" } },
          },
        },
        scoreDef,
      ),
    ).toThrow();
    const noul = validateDecisionResponse(
      {
        ...raw,
        answers: { actionable: { type: "noul", noul: 0.5, confidence: 1 } },
      },
      decisionDefinitions["starter-request"],
    );
    expect(noul.answers.actionable).toEqual({ type: "noul", noul: 0.5 });
    expect(() =>
      validateDecisionResponse(
        { ...raw, answers: { clarity: { type: "noul", noul: 0.5 } } },
        scoreDef,
      ),
    ).toThrow();
  });
});

describe("Jev atomic admission and durable one-attempt claim", () => {
  it("success contains no stored input/answer/hash; retry same or different input never fetches", async () => {
    const result = await evaluate();
    expect(result.reviewRequired).toBe(true);
    expect(result.answers.intent).toEqual(fixture().answers.intent);
    const row = await getDecisionRow(db, alice.id, key());
    expect(row?.state).toBe("succeeded");
    expect(row?.expires_at).toBe(
      (row?.finished_at ?? 0) + decisionLimits.retentionMs,
    );
    await expect(evaluate()).rejects.toMatchObject({
      status: 409,
      code: "decision_already_used",
    });
    await expect(
      evaluateDecision(
        { env: config, identity: alice, fetcher },
        "starter-intent",
        { input: "different" },
        key(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const stored = await db.prepare("SELECT * FROM decision_requests").first();
    expect(
      Object.keys(stored ?? {}).some((k) =>
        /hash|answer|payload|input_json/.test(k),
      ),
    ).toBe(false);
    expect(Object.values(stored ?? {})).not.toContain(input.input);
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(sent.state).toEqual(input);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });
  it("concurrent same key permits exactly one fetch; other owner has separate namespace", async () => {
    const results = await Promise.allSettled([
      evaluate(),
      evaluate(),
      evaluate(),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await evaluate(1, bob);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("owner concurrent1 and environment concurrent3 retain unknown", async () => {
    for (let i = 0; i < 3; i++) {
      const owner = `TEST_ONLY_unknown_${i}`;
      await reserveDecision(db, owner, key(i + 1), def, Date.now());
      await claimDecision(db, owner, key(i + 1), Date.now());
      await finishDecision(
        db,
        owner,
        key(i + 1),
        "submitting",
        "submission_unknown",
        "decision_submission_unknown",
        Date.now(),
      );
    }
    await expect(evaluate()).rejects.toMatchObject({
      code: "decision_limit_exceeded",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM decision_requests WHERE state='submission_unknown' AND expires_at IS NULL",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(3);
  });
  it("concurrent different keys for same owner and four owners obey1/3", async () => {
    const now = Date.now();
    const same = await Promise.allSettled(
      [1, 2].map((n) => reserveDecision(db, alice.id, key(n), def, now)),
    );
    expect(same.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const others = await Promise.allSettled(
      [3, 4, 5].map((n) =>
        reserveDecision(db, `TEST_ONLY_${n}`, key(n), def, now),
      ),
    );
    expect(others.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  });
  it("owner20/21 and rolling5/6, with exact60s boundary", async () => {
    const now = Date.now();
    const start = Date.parse(`${day()}T00:00:00Z`);
    for (let n = 1; n <= 19; n++) await seed(alice.id, n, start);
    await evaluate(20);
    await expect(evaluate(21)).rejects.toMatchObject({ status: 429 });
    await db.prepare("DELETE FROM decision_requests").run();
    for (let n = 1; n <= 4; n++) await seed(alice.id, n, now - 1000);
    await seed(alice.id, 99, now - 60000);
    await reserveDecision(db, alice.id, key(5), def, now);
    await finishDecision(
      db,
      alice.id,
      key(5),
      "reserved",
      "failed",
      "decision_guard_rejected",
      now,
    );
    await expect(
      reserveDecision(db, alice.id, key(6), def, now),
    ).rejects.toMatchObject({ status: 429 });
  });
  it("environment200/201 cannot race past cap", async () => {
    const now = Date.now();
    const statements = Array.from({ length: 199 }, (_, i) =>
      db
        .prepare(
          `INSERT INTO decision_requests(owner_id,request_key,request_day,definition_id,contract_version,model_id,question_count,state,error_code,created_at,reservation_until,finished_at,expires_at) VALUES (?,?,?,'starter-intent','starter-intent-v1','jev-1.13.0',1,'failed','decision_guard_rejected',?,?,?,?)`,
        )
        .bind(
          `TEST_ONLY_seed_${i}`,
          key(i + 1),
          day(),
          now,
          now + 30000,
          now,
          now + decisionLimits.retentionMs,
        ),
    );
    await db.batch(statements);
    const results = await Promise.allSettled([
      evaluate(200),
      evaluate(201, bob),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("new old-day key is400, persisted old-day key is409, daily cap resets", async () => {
    const yesterday = Date.now() - 86400000;
    const oldDay = new Date(yesterday).toISOString().slice(0, 10);
    await expect(
      evaluateDecision(
        { env: config, identity: alice, fetcher },
        "starter-intent",
        input,
        key(1, oldDay),
      ),
    ).rejects.toMatchObject({ code: "request_day_mismatch" });
    for (let i = 1; i <= 20; i++) await seed(alice.id, i, yesterday);
    await expect(
      evaluateDecision(
        { env: config, identity: alice, fetcher },
        "starter-intent",
        input,
        key(1, oldDay),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await evaluate(21);
  });
});

describe("Jev failures, leases and retention", () => {
  it.each([401, 422, 429, 529])(
    "known upstream %s is failed with one consumed reservation",
    async (status) => {
      fetcher.mockResolvedValue(
        new Response("TEST_ONLY_raw_error", { status }),
      );
      await expect(evaluate()).rejects.toMatchObject({
        status: status === 422 ? 502 : 503,
      });
      expect((await getDecisionRow(db, alice.id, key()))?.state).toBe("failed");
      await expect(evaluate()).rejects.toMatchObject({ status: 409 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([302, 500, 503])(
    "unclassified upstream %s is unknown and blocks new key",
    async (status) => {
      fetcher.mockResolvedValue(
        new Response(null, {
          status,
          headers: { Location: "https://other.example.invalid" },
        }),
      );
      await expect(evaluate()).rejects.toMatchObject({
        code: "decision_submission_unknown",
      });
      await expect(evaluate(2)).rejects.toMatchObject({ status: 429 });
      expect(
        (await getDecisionRow(db, alice.id, key()))?.expires_at,
      ).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("full invalid200 is failed; over64KiB and interrupted stream are unknown", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ model: "jev-latest" }));
    await expect(evaluate()).rejects.toMatchObject({
      code: "decision_invalid_response",
    });
    fetcher.mockResolvedValueOnce(
      new Response("x".repeat(65537), {
        headers: { "Content-Type": "application/json", "Content-Length": "1" },
      }),
    );
    await expect(evaluate(2)).rejects.toMatchObject({
      code: "decision_submission_unknown",
    });
    expect((await getDecisionRow(db, alice.id, key(2)))?.state).toBe(
      "submission_unknown",
    );
  });
  it("connection rejection never exposes error and persists unknown", async () => {
    fetcher.mockRejectedValue(new Error("TEST_ONLY_do_not_expose"));
    await expect(evaluate()).rejects.toMatchObject({
      code: "decision_submission_unknown",
    });
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe(
      "submission_unknown",
    );
  });
  it("timeout is enforced even if injected fetch ignores AbortSignal", async () => {
    fetcher.mockImplementation(() => new Promise(() => {}));
    await expect(
      fetchDecision(
        serializePayload(def, input),
        def,
        "TEST_ONLY_dummy_key",
        new AbortController().signal,
        5,
        fetcher,
      ),
    ).rejects.toMatchObject({
      status: 504,
      code: "decision_timeout",
      uncertain: true,
    });
  });
  it("service timeout shortens fetch to leave5s and retains unknown without retry", async () => {
    fetcher.mockImplementation(() => new Promise(() => {}));
    // 送信可能な窓を約2秒にする。fetchMs(15秒)のままならテスト上限(5秒)を超えるので、
    // 短縮の検証になる。窓を200msにするとCIの遅延で送信前に期限切れになり不安定だった。
    await expect(evaluate(1, alice, Date.now() - 13000)).rejects.toMatchObject({
      status: 504,
      code: "decision_timeout",
    });
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe(
      "submission_unknown",
    );
    await expect(evaluate(2)).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("abort after send retains unknown; pre-abort and exhausted deadline send0", async () => {
    const controller = new AbortController();
    fetcher.mockImplementation(async () => {
      controller.abort();
      throw new Error("TEST_ONLY_abort");
    });
    await expect(
      evaluate(1, alice, undefined, controller.signal),
    ).rejects.toMatchObject({ status: 504 });
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe(
      "submission_unknown",
    );
    fetcher.mockClear();
    await expect(evaluate(2, bob, Date.now() - 20001)).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      evaluate(2, bob, undefined, AbortSignal.abort()),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("expired reserved becomes failed; expired submitting becomes unknown; maintenance bounded", async () => {
    const now = Date.now();
    await seed("TEST_ONLY_reserved", 1, now - 31000, "reserved");
    await seed("TEST_ONLY_submitting", 2, now - 31000, "reserved");
    await claimDecision(db, "TEST_ONLY_submitting", key(2), now - 31000);
    await evaluate(3);
    expect(
      (await getDecisionRow(db, "TEST_ONLY_reserved", key(1)))?.state,
    ).toBe("failed");
    expect(
      (await getDecisionRow(db, "TEST_ONLY_submitting", key(2)))?.state,
    ).toBe("submission_unknown");
    const old = now - decisionLimits.retentionMs - 1000;
    for (let n = 1; n <= 101; n++) await seed(`TEST_ONLY_old_${n}`, n, old);
    await evaluate(4, bob);
    expect(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM decision_requests WHERE expires_at<=?",
          )
          .bind(Date.now())
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (await getDecisionRow(db, "TEST_ONLY_submitting", key(2)))?.state,
    ).toBe("submission_unknown");
  });
  it("DB reservation result lost prevents fetch; replay cannot reserve again", async () => {
    const original = db.batch.bind(db);
    vi.spyOn(db, "batch").mockImplementationOnce(async (queries) => {
      await original(queries);
      throw new Error("TEST_ONLY_lost_response");
    });
    await expect(evaluate()).rejects.toMatchObject({
      code: "decision_ledger_unavailable",
    });
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe("reserved");
    await expect(evaluate()).rejects.toMatchObject({ status: 409 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("guard after reservation rejects and consumes without fetch", async () => {
    const original = db.batch.bind(db);
    vi.spyOn(db, "batch").mockImplementationOnce(async (queries) => {
      const result = await original(queries);
      config.JEV_MODEL = "jev-latest";
      return result;
    });
    await expect(evaluate()).rejects.toMatchObject({ status: 503 });
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("guard after complete response refuses result and cannot infer again", async () => {
    fetcher.mockImplementation(async () => {
      config.TYPESAFE_API_KEY = undefined;
      return Response.json(fixture());
    });
    await expect(evaluate()).rejects.toMatchObject({ status: 503 });
    expect((await getDecisionRow(db, alice.id, key()))?.state).toBe("failed");
    await expect(evaluate()).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Jev HTTP dispatch and metadata recovery", () => {
  const request = (
    path = "classify",
    method = "POST",
    body: unknown = { ...input, requestKey: key() },
    headers: HeadersInit = {},
  ) =>
    new Request(`${config.APP_ORIGIN}/api/decisions/${path}`, {
      method,
      headers: {
        Origin: config.APP_ORIGIN,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
  const send = (r: Request) => api.fetch(r, config, createExecutionContext());
  beforeEach(() => {
    vi.spyOn(auth, "getIdentity").mockResolvedValue(alice);
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("authenticated classify200, status metadata only, other owner indistinguishable404", async () => {
    const response = await send(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      answer: fixture().answers.intent,
      resultAvailableOnReload: false,
    });
    const status = await send(request(`requests/${key()}`, "GET"));
    expect(await status.json()).toMatchObject({
      state: "succeeded",
      resultAvailable: false,
    });
    vi.mocked(auth.getIdentity).mockResolvedValue(bob);
    expect((await send(request(`requests/${key()}`, "GET"))).status).toBe(404);
  });
  it.each([undefined, "off"])(
    "consistent OFF %s precedes auth and method; status still readable",
    async (mode) => {
      config.JEV_MODE = mode;
      config.JEV_MODEL = undefined;
      vi.mocked(auth.getIdentity).mockResolvedValue(null);
      expect((await send(request("classify", "GET"))).status).toBe(404);
      expect(auth.getIdentity).not.toHaveBeenCalled();
      expect((await send(request(`requests/${key()}`, "GET"))).status).toBe(
        401,
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("outer origin guard retains private cache headers before auth or fetch", async () => {
    const response = await send(
      new Request("https://other.example.invalid/api/decisions/classify", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: "invalid_application_origin",
    });
    expect(auth.getIdentity).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("ON auth then method/origin/content type/schema; unknown route404", async () => {
    vi.mocked(auth.getIdentity).mockResolvedValueOnce(null);
    expect((await send(request("classify", "GET"))).status).toBe(401);
    expect((await send(request("classify", "GET"))).status).toBe(405);
    expect(
      (
        await send(
          request("classify", "POST", undefined, {
            Origin: "https://other.example.invalid",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await send(
          request("classify", "POST", undefined, {
            "Content-Type": "text/plain",
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await send(
          request("classify", "POST", {
            ...input,
            requestKey: key(),
            questions: {},
          }),
        )
      ).status,
    ).toBe(400);
    expect((await send(request("other", "GET"))).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("real body limit, invalid UTF8 and compression are rejected", async () => {
    const huge = new Request(`${config.APP_ORIGIN}/api/decisions/classify`, {
      method: "POST",
      headers: {
        Origin: config.APP_ORIGIN,
        "Content-Type": "application/json",
        "Content-Length": "1",
      },
      body: "x".repeat(16385),
    });
    expect((await send(huge)).status).toBe(413);
    const malformed = new Request(
      `${config.APP_ORIGIN}/api/decisions/classify`,
      {
        method: "POST",
        headers: {
          Origin: config.APP_ORIGIN,
          "Content-Type": "application/json",
        },
        body: new Uint8Array([0xff]),
      },
    );
    expect((await send(malformed)).status).toBe(400);
    expect(
      (
        await send(
          request("classify", "POST", undefined, {
            "Content-Encoding": "gzip",
          }),
        )
      ).status,
    ).toBe(415);
  });
  it.each(["off", "invalid", "remote"])(
    "status recovers with Jev%s/chat misconfiguration and legacy ledger",
    async (mode) => {
      await evaluate();
      config.JEV_MODE = mode;
      config.JEV_MODEL = mode === "off" ? undefined : "jev-latest";
      await db
        .prepare(
          "INSERT INTO ai_verification(id,owner_id,started_at,expires_at,attempts) VALUES (1,'TEST_ONLY_legacy',0,1800000,3)",
        )
        .run();
      expect((await send(request(`requests/${key()}`, "GET"))).status).toBe(
        200,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("expired GET404 makes no ledger mutation; expired lease display also read-only", async () => {
    const now = Date.now();
    const k = await seed(alice.id, 1, now - decisionLimits.retentionMs);
    expect((await send(request(`requests/${k}`, "GET"))).status).toBe(404);
    expect(await getDecisionRow(db, alice.id, k)).not.toBeNull();
    const k2 = await seed(alice.id, 2, now - 31000, "reserved");
    const response = await send(request(`requests/${k2}`, "GET"));
    expect(await response.json()).toMatchObject({
      state: "failed",
      finishedAt: null,
    });
    expect((await getDecisionRow(db, alice.id, k2))?.state).toBe("reserved");
  });
  it("GET counter60/61 does not consume POST quota or extend expiry", async () => {
    await evaluate();
    const row = await getDecisionRow(db, alice.id, key());
    // rateLimitは1分単位の固定枠。61回の途中で分をまたぐと数え直しになるため時刻を止める。
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    for (let n = 0; n < 60; n++)
      expect((await send(request(`requests/${key()}`, "GET"))).status).toBe(
        200,
      );
    expect((await send(request(`requests/${key()}`, "GET"))).status).toBe(429);
    expect(await getDecisionRow(db, alice.id, key())).toEqual(row);
  });
  it.each([
    { JEV_MODE: "off", JEV_MODEL: "jev-1.13.0" },
    { JEV_MODE: "invalid" },
    { JEV_MODEL: "jev-latest" },
    { TYPESAFE_API_KEY: undefined },
    { STAGING_POLICY: undefined },
    { STAGING_POLICY: "verification", AI_VERIFICATION_ENABLED: "false" },
  ])("misconfiguration/legacy precludes fetch %#", async (patch) => {
    Object.assign(config, patch);
    const response = await send(request());
    expect([404, 503]).toContain(response.status);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await getDecisionRow(db, alice.id, key())).toBeNull();
  });
  it("old verification ledger and missing decision table are503 without mutation/fetch", async () => {
    await db
      .prepare(
        "INSERT INTO ai_verification(id,owner_id,started_at,expires_at,attempts) VALUES (1,'TEST_ONLY_legacy',0,1800000,3)",
      )
      .run();
    expect((await send(request())).status).toBe(503);
    await db.prepare("DELETE FROM ai_verification").run();
    await db.prepare("DROP TABLE decision_requests").run();
    expect((await send(request())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
