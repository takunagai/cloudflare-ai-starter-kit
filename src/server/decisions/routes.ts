import { getIdentity } from "../auth";
import { rateLimit } from "../chat-store";
import { ApiError, json, requireSameOrigin } from "../http";
import { classifySchema, validRequestKey } from "./contracts";
import { getDecisionRow, visibleState } from "./ledger";
import {
  DecisionDeadline,
  type DecisionEnv,
  evaluateDecision,
  requireDecisionEnabled,
} from "./service";

function decisionJson(body: unknown, status = 200) {
  return json(body, status, { "Cache-Control": "private, no-store" });
}
export async function handleDecisions(
  request: Request,
  env: DecisionEnv,
  receivedAt: number,
): Promise<Response> {
  const deadline = new DecisionDeadline(receivedAt, request.signal);
  try {
    const path = new URL(request.url).pathname;
    const classify = path === "/api/decisions/classify";
    const match = /^\/api\/decisions\/requests\/([^/]+)$/.exec(path);
    if (!classify && !match) throw new ApiError(404, "not_found");
    if (classify) requireDecisionEnabled(env);
    const identity = await deadline.wait(getIdentity(request, env));
    if (!identity) throw new ApiError(401, "authentication_required");
    if (request.method !== (classify ? "POST" : "GET"))
      throw new ApiError(405, "method_not_allowed");
    requireSameOrigin(request);
    if (match) {
      if (!validRequestKey(match[1])) throw new ApiError(400, "invalid_input");
      await deadline.wait(
        rateLimit(env, identity.id, "decision-status", 60),
        "decision_ledger_unavailable",
      );
      const row = await deadline.wait(
        getDecisionRow(env.DB, identity.id, match[1]),
        "decision_ledger_unavailable",
      );
      const now = Date.now();
      if (!row || (row.expires_at !== null && row.expires_at <= now))
        throw new ApiError(404, "not_found");
      const state = visibleState(row, now);
      return decisionJson({
        requestKey: match[1],
        state,
        errorCode:
          state === row.state
            ? row.error_code
            : state === "failed"
              ? "decision_reservation_expired"
              : "decision_submission_unknown",
        createdAt: row.created_at,
        sentAt: row.sent_at,
        finishedAt: row.finished_at,
        expiresAt: row.expires_at,
        resultAvailable: false,
      });
    }
    if (
      request.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json" ||
      (request.headers.has("Content-Encoding") &&
        request.headers.get("Content-Encoding") !== "identity")
    )
      throw new ApiError(415, "unsupported_media_type");
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "invalid_json");
    let text = "";
    let bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (;;) {
        const part = await deadline.wait(reader.read());
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 16384) throw new ApiError(413, "payload_too_large");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "invalid_json");
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApiError(400, "invalid_json");
    }
    const parsed = classifySchema.safeParse(value);
    if (!parsed.success) throw new ApiError(400, "invalid_input");
    const { requestKey, input } = parsed.data;
    const result = await evaluateDecision(
      { env, identity, signal: deadline.controller.signal, receivedAt },
      "starter-intent",
      { input },
      requestKey,
    );
    return decisionJson({
      requestKey: result.requestKey,
      contractVersion: result.contractVersion,
      model: result.model,
      answer: result.answers.intent,
      reviewRequired: result.reviewRequired,
      usage: result.usage,
      resultAvailableOnReload: false,
    });
  } catch (error) {
    if (error instanceof ApiError)
      return decisionJson(
        {
          error: error.code,
          ...(error.code === "request_day_mismatch"
            ? { currentUtcDay: new Date().toISOString().slice(0, 10) }
            : {}),
        },
        error.status,
      );
    return decisionJson({ error: "decision_ledger_unavailable" }, 503);
  } finally {
    deadline.dispose();
  }
}
