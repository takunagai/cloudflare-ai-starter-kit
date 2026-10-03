import { z } from "zod";

export const intentLabels = {
  technical: "技術相談",
  writing: "文章作成",
  planning: "計画整理",
  none: "該当なし",
} as const;
export type Intent = keyof typeof intentLabels;
const probability = z.number().finite().min(0).max(1);
export function validDecisionKey(key: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      key,
    )
  )
    return false;
  const date = new Date(`${key.slice(0, 10)}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === key.slice(0, 10)
  );
}
export function validDecisionInput(input: string) {
  return (
    input.trim().length > 0 &&
    !/[\uD800-\uDFFF]/u.test(input) &&
    !input.includes("\0") &&
    Array.from(input).length <= 2000 &&
    new TextEncoder().encode(input).byteLength <= 8000
  );
}
const successSchema = z
  .object({
    requestKey: z.string().refine(validDecisionKey),
    contractVersion: z.literal("starter-intent-v1"),
    model: z.literal("jev-1.13.0"),
    answer: z
      .object({
        type: z.literal("choice"),
        choice: z.enum(["technical", "writing", "planning", "none"]),
        probabilities: z
          .object({
            technical: probability,
            writing: probability,
            planning: probability,
            none: probability,
          })
          .strict(),
        confidence: probability,
      })
      .strict(),
    reviewRequired: z.literal(true),
    usage: z
      .object({
        inputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        outputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    resultAvailableOnReload: z.literal(false),
  })
  .strict()
  .refine(
    ({ answer }) =>
      Math.abs(
        Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0) - 1,
      ) <= 0.001 &&
      Object.values(answer.probabilities).every(
        (p) => p <= answer.probabilities[answer.choice],
      ),
  );
export type Classification = z.infer<typeof successSchema>;
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const metadataSchema = z
  .object({
    requestKey: z.string().refine(validDecisionKey),
    state: z.enum([
      "reserved",
      "submitting",
      "succeeded",
      "failed",
      "submission_unknown",
    ]),
    errorCode: z
      .string()
      .regex(/^[a-z_]{1,100}$/)
      .nullable(),
    createdAt: timestamp,
    sentAt: timestamp.nullable(),
    finishedAt: timestamp.nullable(),
    expiresAt: timestamp.nullable(),
    resultAvailable: z.literal(false),
  })
  .strict();
export type DecisionMetadata = z.infer<typeof metadataSchema>;
export type Attempt = {
  key: string;
  disposition: "terminal" | "unresolved";
  code?: string;
  result?: Classification;
};
export function applyDecisionMetadata(
  attempt: Attempt,
  metadata: DecisionMetadata,
): Attempt {
  if (attempt.key !== metadata.requestKey) return attempt;
  return {
    ...attempt,
    disposition:
      metadata.state === "succeeded" || metadata.state === "failed"
        ? "terminal"
        : "unresolved",
  };
}

// These are static examples, never fallback responses from the API.
export const classificationFixtures: ReadonlyArray<{
  label: string;
  input: string;
  result: Classification;
}> = [
  {
    label: "計画整理の合成例",
    input: "来週の勉強会の準備を順番に整理したい",
    result: {
      requestKey: "2026-10-02:11111111-1111-4111-8111-111111111111",
      contractVersion: "starter-intent-v1",
      model: "jev-1.13.0",
      answer: {
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
      reviewRequired: true,
      usage: { inputTokens: 320, outputTokens: 40 },
      resultAvailableOnReload: false,
    },
  },
  {
    label: "該当なしの合成例",
    input: "こんにちは",
    result: {
      requestKey: "2026-10-02:22222222-2222-4222-8222-222222222222",
      contractVersion: "starter-intent-v1",
      model: "jev-1.13.0",
      answer: {
        type: "choice",
        choice: "none",
        probabilities: {
          technical: 0.05,
          writing: 0.05,
          planning: 0.1,
          none: 0.8,
        },
        confidence: 0.5,
      },
      reviewRequired: true,
      usage: { inputTokens: 280, outputTokens: 40 },
      resultAvailableOnReload: false,
    },
  },
  {
    label: "不確実な合成例",
    input: "不具合を調べて、案内文と対応計画も考えたい",
    result: {
      requestKey: "2026-10-02:33333333-3333-4333-8333-333333333333",
      contractVersion: "starter-intent-v1",
      model: "jev-1.13.0",
      answer: {
        type: "choice",
        choice: "none",
        probabilities: {
          technical: 0.25,
          writing: 0.24,
          planning: 0.25,
          none: 0.26,
        },
        confidence: 0.02,
      },
      reviewRequired: true,
      usage: { inputTokens: 340, outputTokens: 40 },
      resultAvailableOnReload: false,
    },
  },
];

async function readJson(response: Response): Promise<unknown> {
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json") ||
    !response.body
  )
    throw new Error("invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) throw new Error("invalid_response");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
// Only known definitive failures allow an explicit new request. Other outcomes stay locked.
const terminalErrors = new Set([
  "decision_disabled",
  "decision_not_configured",
  "authentication_required",
  "invalid_input",
  "invalid_json",
  "request_day_mismatch",
  "method_not_allowed",
  "unsupported_media_type",
  "payload_too_large",
  "decision_limit_exceeded",
  "decision_upstream_auth",
  "decision_upstream_invalid_request",
  "decision_upstream_rate_limited",
  "decision_upstream_overloaded",
  "decision_invalid_response",
  "decision_guard_rejected",
  "decision_reservation_expired",
  "decision_already_used",
]);
function fixedError(raw: unknown): string {
  const parsed = z.object({ error: z.string() }).safeParse(raw);
  if (!parsed.success) return "decision_response_lost";
  const code = parsed.data.error;
  return terminalErrors.has(code) ||
    [
      "decision_submission_unknown",
      "decision_timeout",
      "decision_ledger_unavailable",
      "decision_in_progress",
    ].includes(code)
    ? code
    : "decision_response_lost";
}
type Fetcher = typeof fetch;
export async function classifyOnce(
  key: string,
  input: string,
  fetcher: Fetcher = fetch,
): Promise<Attempt> {
  if (!validDecisionKey(key) || !validDecisionInput(input))
    return { key, disposition: "terminal", code: "invalid_input" };
  try {
    const response = await fetcher("/api/decisions/classify", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestKey: key, input }),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await readJson(response);
    if (!response.ok) {
      const code = fixedError(raw);
      return {
        key,
        disposition: terminalErrors.has(code) ? "terminal" : "unresolved",
        code,
      };
    }
    const parsed = successSchema.safeParse(raw);
    if (!parsed.success || parsed.data.requestKey !== key)
      return { key, disposition: "unresolved", code: "decision_response_lost" };
    return { key, disposition: "terminal", result: parsed.data };
  } catch {
    return { key, disposition: "unresolved", code: "decision_response_lost" };
  }
}
export async function readDecisionMetadata(
  key: string,
  fetcher: Fetcher = fetch,
): Promise<DecisionMetadata> {
  if (!validDecisionKey(key)) throw new Error("invalid_input");
  const response = await fetcher(`/api/decisions/requests/${key}`, {
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const raw = await readJson(response);
  const parsed = metadataSchema.safeParse(raw);
  if (!response.ok || !parsed.success || parsed.data.requestKey !== key)
    throw new Error("status_unavailable");
  return parsed.data;
}
