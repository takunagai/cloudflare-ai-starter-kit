import { describe, expect, it, vi } from "vitest";
import {
  type Attempt,
  applyDecisionMetadata,
  classificationFixtures,
  classifyOnce,
  type DecisionMetadata,
  intentLabels,
  readDecisionMetadata,
  validDecisionInput,
  validDecisionKey,
} from "../src/lib/decision-example";
import {
  classifySchema,
  decisionDefinitions,
  validateDecisionResponse,
  validRequestKey,
} from "../src/server/decisions/contracts";

const fixture = classificationFixtures[0].result;
const key = fixture.requestKey;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const input = "準備を整理したい";
describe("C-J: classification example without live inference", () => {
  it("keeps exactly the registered four candidates and validates every synthetic example", () => {
    expect(Object.keys(intentLabels)).toEqual(
      Object.keys(
        decisionDefinitions["starter-intent"].questions.intent.criteria,
      ),
    );
    for (const item of classificationFixtures) {
      expect(
        classifySchema.safeParse({
          requestKey: item.result.requestKey,
          input: item.input,
        }).success,
      ).toBe(true);
      expect(() =>
        validateDecisionResponse(
          {
            model: item.result.model,
            answers: { intent: item.result.answer },
            usage: {
              input_tokens: item.result.usage.inputTokens,
              output_tokens: item.result.usage.outputTokens,
            },
          },
          decisionDefinitions["starter-intent"],
        ),
      ).not.toThrow();
      expect(item.result.reviewRequired).toBe(true);
    }
    expect(classificationFixtures[1].result.answer.choice).toBe("none");
    expect(classificationFixtures[2].result.answer.confidence).toBe(0.02);
  });
  it("uses UTC request keys and rejects invalid dates, uppercase and older UUID formats", () => {
    for (const candidate of [
      key,
      key.replace("2026-10-02", "2026-02-30"),
      key.replace("4111", "1111"),
      key.replace("11111111-", "AAAAAAAA-"),
    ]) {
      expect(validDecisionKey(candidate)).toBe(validRequestKey(candidate));
    }
  });
  it("validates Unicode points and UTF-8 without truncating or normalizing input", () => {
    for (const text of [
      input,
      "\n ",
      "😀".repeat(2000),
      "😀".repeat(2001),
      "あ".repeat(2000),
      "\uD800",
      "a\0b",
    ]) {
      expect(validDecisionInput(text)).toBe(
        classifySchema.safeParse({ requestKey: key, input: text }).success,
      );
    }
  });
  it("rejects invalid local input without making a POST", async () => {
    const fetcher = vi.fn();
    expect((await classifyOnce(key, " ", fetcher)).code).toBe("invalid_input");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends exactly one strict POST, forbids redirects, and preserves all response numbers", async () => {
    const fetcher = vi.fn(async () => response(fixture));
    const result = await classifyOnce(key, ` ${input} `, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      "/api/decisions/classify",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ requestKey: key, input: ` ${input} ` }),
      }),
    ]);
    expect(result.result).toEqual(fixture);
    expect(result.disposition).toBe("terminal");
  });
  it("returns OFF as disconnected without a synthetic fallback", async () => {
    const fetcher = vi.fn(async () =>
      response({ error: "decision_disabled" }, 404),
    );
    const result = await classifyOnce(key, input, fetcher);
    expect(result).toEqual({
      key,
      disposition: "terminal",
      code: "decision_disabled",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    "decision_submission_unknown",
    "decision_timeout",
    "decision_ledger_unavailable",
    "decision_in_progress",
  ])("locks %s with no retry", async (code) => {
    const fetcher = vi.fn(async () => response({ error: code }, 503));
    expect(await classifyOnce(key, input, fetcher)).toEqual({
      key,
      disposition: "unresolved",
      code,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...fixture, requestKey: classificationFixtures[1].result.requestKey },
    { ...fixture, model: "jev-latest" },
    { ...fixture, reviewRequired: false },
    { ...fixture, answer: { ...fixture.answer, confidence: 1.1 } },
    {
      ...fixture,
      answer: {
        ...fixture.answer,
        probabilities: { ...fixture.answer.probabilities, other: 0 },
      },
    },
    { ...fixture, answer: { ...fixture.answer, choice: "technical" } },
    { ...fixture, usage: { inputTokens: -1, outputTokens: 0 } },
  ])(
    "does not turn an invalid success response into a fallback or retry",
    async (raw) => {
      const fetcher = vi.fn(async () => response(raw));
      expect(await classifyOnce(key, input, fetcher)).toEqual({
        key,
        disposition: "unresolved",
        code: "decision_response_lost",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps a lost response unresolved without exposing transport details", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("TEST_ONLY_private_transport_detail");
    });
    expect(await classifyOnce(key, input, fetcher)).toEqual({
      key,
      disposition: "unresolved",
      code: "decision_response_lost",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds malformed and oversized responses", async () => {
    for (const body of ["not JSON", "x".repeat(65537)]) {
      expect(
        (
          await classifyOnce(
            key,
            input,
            async () =>
              new Response(body, {
                headers: { "Content-Type": "application/json" },
              }),
          )
        ).disposition,
      ).toBe("unresolved");
    }
  });
  it("reads status with an unchanged validated key and never makes a POST", async () => {
    const value: DecisionMetadata = {
      requestKey: key,
      state: "submission_unknown",
      errorCode: "decision_submission_unknown",
      createdAt: 1,
      sentAt: 2,
      finishedAt: null,
      expiresAt: null,
      resultAvailable: false,
    };
    const fetcher = vi.fn(async () => response(value));
    expect(await readDecisionMetadata(key, fetcher)).toEqual(value);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      `/api/decisions/requests/${key}`,
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    ]);
    const attempt: Attempt = {
      key,
      disposition: "unresolved",
      code: "decision_response_lost",
    };
    expect(applyDecisionMetadata(attempt, value).disposition).toBe(
      "unresolved",
    );
    expect(
      applyDecisionMetadata(attempt, { ...value, state: "succeeded" })
        .disposition,
    ).toBe("terminal");
    expect(
      applyDecisionMetadata(attempt, {
        ...value,
        requestKey: classificationFixtures[1].result.requestKey,
        state: "succeeded",
      }),
    ).toBe(attempt);
  });
  it("does not use status errors, a different key or stored result to unlock a request", async () => {
    for (const raw of [
      { error: "not_found" },
      { requestKey: "not-a-key" },
      { ...fixture, resultAvailable: true },
    ]) {
      const fetcher = vi.fn(async () => response(raw));
      await expect(readDecisionMetadata(key, fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
