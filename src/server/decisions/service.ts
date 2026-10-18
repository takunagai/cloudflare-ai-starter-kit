import type { Identity } from "../env";
import { ApiError } from "../http";
import {
  checkRuntimeBoundary,
  isStagingWithoutStandardPolicy,
  type RuntimeEnv,
} from "../runtime-guards";
import { resolveRuntimePolicy } from "../runtime-policy";
import { DecisionTransportError, fetchDecision } from "./adapter";
import {
  type DecisionDefinitionId,
  decisionDefinitions,
  decisionLimits,
  inputSchema,
  serializePayload,
  validRequestKey,
} from "./contracts";
import {
  claimDecision,
  duplicateError,
  finishDecision,
  getDecisionRow,
  reserveDecision,
} from "./ledger";

export type DecisionEnv = RuntimeEnv & { TYPESAFE_API_KEY?: string };
export type DecisionContext = {
  env: DecisionEnv;
  identity: Identity;
  signal?: AbortSignal;
  receivedAt?: number;
  fetcher?: typeof fetch;
};

/** A wait limit does not cancel D1. Every continuation checks before proceeding. */
export class DecisionDeadline {
  readonly controller = new AbortController();
  readonly until: number;
  private timer: ReturnType<typeof setTimeout>;
  private signal?: AbortSignal;
  private abort = () => this.controller.abort();
  constructor(receivedAt = Date.now(), signal?: AbortSignal) {
    this.until = receivedAt + decisionLimits.deadlineMs;
    this.signal = signal;
    this.timer = setTimeout(this.abort, Math.max(0, this.remaining()));
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  remaining() {
    return this.until - Date.now();
  }
  check(code = "decision_timeout") {
    if (this.remaining() <= 0 || this.controller.signal.aborted)
      throw new ApiError(
        code === "decision_ledger_unavailable" ? 503 : 504,
        code,
      );
  }
  async wait<T>(task: Promise<T>, code = "decision_timeout"): Promise<T> {
    try {
      this.check(code);
    } catch (error) {
      void task.catch(() => {});
      throw error;
    }
    const signal = this.controller.signal;
    let stop: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        stop = () =>
          reject(
            new ApiError(
              code === "decision_ledger_unavailable" ? 503 : 504,
              code,
            ),
          );
        signal.addEventListener("abort", stop, { once: true });
      });
      const result = await Promise.race([task, aborted]);
      this.check(code);
      return result;
    } finally {
      if (stop) signal.removeEventListener("abort", stop);
    }
  }
  dispose() {
    clearTimeout(this.timer);
    this.signal?.removeEventListener("abort", this.abort);
  }
}

export function requireDecisionEnabled(env: DecisionEnv) {
  // OFF validation is deliberately independent of the shared boundary/chat policy.
  if (
    isStagingWithoutStandardPolicy(env) ||
    ((env.JEV_MODE === undefined || env.JEV_MODE === "off") &&
      env.JEV_MODEL === undefined)
  )
    throw new ApiError(404, "decision_disabled");
}
export async function checkDecisionGuard(env: DecisionEnv) {
  requireDecisionEnabled(env);
  await checkRuntimeBoundary(env);
  const policy = resolveRuntimePolicy(env).jev;
  if (!policy.ok) throw new ApiError(503, policy.code);
  if (policy.value.mode !== "remote")
    throw new ApiError(503, "invalid_jev_mode");
  if (typeof env.TYPESAFE_API_KEY !== "string" || !env.TYPESAFE_API_KEY.trim())
    throw new ApiError(503, "decision_not_configured");
  return policy.value.model;
}

/** Only admission path: registered definition, verified identity, durable quota/claim. */
export async function evaluateDecision(
  context: DecisionContext,
  definitionId: DecisionDefinitionId,
  state: unknown,
  requestKey: string,
) {
  const { env, identity } = context;
  const owner = identity.id;
  const db = env.DB;
  const deadline = new DecisionDeadline(context.receivedAt, context.signal);
  const dbWait = <T>(task: () => Promise<T>) => {
    deadline.check("decision_ledger_unavailable");
    return deadline.wait(task(), "decision_ledger_unavailable");
  };
  let reserved = false;
  let claimed = false;
  let claimStarted = false;
  let finishing = false;
  let responseComplete = false;
  let validatedUsage: { inputTokens: number; outputTokens: number } | undefined;
  try {
    requireDecisionEnabled(env);
    if (!owner) throw new ApiError(401, "authentication_required");
    if (
      !Object.hasOwn(decisionDefinitions, definitionId) ||
      !validRequestKey(requestKey)
    )
      throw new ApiError(400, "invalid_input");
    const definition = decisionDefinitions[definitionId];
    const parsed = inputSchema.safeParse(state);
    if (!parsed.success) throw new ApiError(400, "invalid_input");
    const payload = serializePayload(definition, parsed.data);
    const existing = await dbWait(() => getDecisionRow(db, owner, requestKey));
    if (existing) duplicateError(existing, Date.now());
    if (requestKey.slice(0, 10) !== new Date().toISOString().slice(0, 10))
      throw new ApiError(400, "request_day_mismatch");
    const guard = async () => {
      deadline.check();
      if (identity.id !== owner || env.DB !== db)
        throw new ApiError(503, "decision_guard_rejected");
      const model = await deadline.wait(checkDecisionGuard(env));
      if (model !== "jev-1.13.0")
        throw new ApiError(503, "decision_guard_rejected");
    };
    await guard();
    await dbWait(() =>
      reserveDecision(db, owner, requestKey, definition, Date.now()),
    );
    reserved = true;
    await guard();
    if (deadline.remaining() <= decisionLimits.saveMarginMs)
      throw new ApiError(504, "decision_timeout");
    claimStarted = true;
    await dbWait(() => claimDecision(db, owner, requestKey, Date.now()));
    claimed = true;
    await guard();
    // No await between this last check and starting the single transport call.
    const timeout = Math.min(
      decisionLimits.fetchMs,
      deadline.remaining() - decisionLimits.saveMarginMs,
    );
    if (timeout <= 0)
      throw new DecisionTransportError(504, "decision_timeout", true);
    const result = await deadline.wait(
      fetchDecision(
        payload,
        definition,
        env.TYPESAFE_API_KEY ?? "",
        deadline.controller.signal,
        timeout,
        context.fetcher ?? fetch,
      ),
    );
    responseComplete = true;
    validatedUsage = result.usage;
    await guard();
    finishing = true;
    await dbWait(() =>
      finishDecision(
        db,
        owner,
        requestKey,
        "submitting",
        "succeeded",
        null,
        Date.now(),
        result.usage,
      ),
    );
    return {
      requestKey,
      contractVersion: definition.version,
      ...result,
      reviewRequired: true,
      resultAvailableOnReload: false,
    };
  } catch (error) {
    // A lost reservation/claim/final write response is never inferred to be undone.
    if (
      reserved &&
      !finishing &&
      !(
        error instanceof ApiError &&
        error.code === "decision_ledger_unavailable"
      ) &&
      !(claimStarted && !claimed)
    ) {
      const uncertain =
        claimed &&
        !responseComplete &&
        (!(error instanceof DecisionTransportError) || error.uncertain);
      // After a complete validated response, guard rejection is a definite failed result.
      const code =
        error instanceof DecisionTransportError
          ? error.code
          : error instanceof ApiError && error.code === "decision_timeout"
            ? "decision_timeout"
            : "decision_guard_rejected";
      // Disconnection must not prevent settlement within the original deadline.
      const settlement = new DecisionDeadline(
        deadline.until - decisionLimits.deadlineMs,
      );
      try {
        settlement.check("decision_ledger_unavailable");
        await settlement.wait(
          finishDecision(
            db,
            owner,
            requestKey,
            claimed ? "submitting" : "reserved",
            uncertain ? "submission_unknown" : "failed",
            uncertain && !(error instanceof DecisionTransportError)
              ? "decision_submission_unknown"
              : code,
            Date.now(),
            responseComplete ? validatedUsage : undefined,
          ),
          "decision_ledger_unavailable",
        );
      } finally {
        settlement.dispose();
      }
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}
