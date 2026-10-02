import { ApiError } from "../http";
import {
  type DecisionDefinition,
  decisionLimits,
  validateDecisionResponse,
} from "./contracts";

export class DecisionTransportError extends ApiError {
  constructor(
    status: number,
    code: string,
    public readonly uncertain: boolean,
  ) {
    super(status, code);
  }
}
async function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop: (() => void) | undefined;
  try {
    if (signal.aborted) {
      void task.catch(() => {});
      throw new Error("aborted");
    }
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        stop = () => reject(new Error("aborted"));
        signal.addEventListener("abort", stop, { once: true });
      }),
    ]);
  } finally {
    if (stop) signal.removeEventListener("abort", stop);
  }
}
// Low-level transport, called only after the service's durable claim. Never retries.
export async function fetchDecision(
  payload: string,
  definition: DecisionDefinition,
  key: string,
  signal: AbortSignal,
  timeoutMs: number,
  fetcher: typeof fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = AbortSignal.any([signal, controller.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await abortable(
      fetcher("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: payload,
        redirect: "manual",
        signal: combined,
      }),
      combined,
    );
    if (combined.aborted)
      throw new DecisionTransportError(504, "decision_timeout", true);
    const known: Record<number, [number, string]> = {
      401: [503, "decision_upstream_auth"],
      422: [502, "decision_upstream_invalid_request"],
      429: [503, "decision_upstream_rate_limited"],
      529: [503, "decision_upstream_overloaded"],
    };
    if (known[response.status]) {
      void response.body?.cancel().catch(() => {});
      throw new DecisionTransportError(...known[response.status], false);
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      throw new DecisionTransportError(
        502,
        "decision_submission_unknown",
        true,
      );
    }
    reader = response.body?.getReader();
    if (!reader)
      throw new DecisionTransportError(502, "decision_invalid_response", false);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await abortable(reader.read(), combined);
      if (combined.aborted)
        throw new DecisionTransportError(504, "decision_timeout", true);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > decisionLimits.responseBytes)
        throw new DecisionTransportError(
          502,
          "decision_submission_unknown",
          true,
        );
      chunks.push(part.value);
    }
    if (
      response.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw new DecisionTransportError(502, "decision_invalid_response", false);
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return validateDecisionResponse(
        JSON.parse(decoder.decode(buffer)),
        definition,
      );
    } catch {
      throw new DecisionTransportError(502, "decision_invalid_response", false);
    }
  } catch (error) {
    if (error instanceof DecisionTransportError) throw error;
    throw new DecisionTransportError(
      combined.aborted ? 504 : 502,
      combined.aborted ? "decision_timeout" : "decision_submission_unknown",
      true,
    );
  } finally {
    clearTimeout(timer);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
