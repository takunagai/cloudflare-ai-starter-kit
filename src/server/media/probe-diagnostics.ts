import { z } from "zod";
import { ApiError } from "../http";
import { privateImageUrl, responseJson } from "./image-driver";
import {
  checkProbeExecution,
  type MediaProbePermit,
  PROBE_MODEL,
  type ProbeDiagnosticReason,
  probeDatabase,
  recordProbeEvidence,
  reserveProbeCall,
} from "./probe-permit";

const TOKEN_ENDPOINT =
  "https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3";
const TOKEN_SCHEMA = z.object({
  token: z.string().min(1).max(4096),
  expires_at: z.union([z.string(), z.number()]),
});
export interface ProbeObservationClock {
  now(): number;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}
const OBSERVATION_CLOCK: ProbeObservationClock = {
  now: () => Date.now(),
  sleep: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, milliseconds);
      function abort() {
        clearTimeout(timer);
        reject(new ApiError(502, "media_probe_observation_unknown"));
      }
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }),
};
async function boundedFetch(
  transport: typeof fetch,
  url: string,
  initialization: RequestInit = {},
) {
  return transport(url, {
    ...initialization,
    redirect: "manual",
    signal: initialization.signal
      ? AbortSignal.any([initialization.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
}
async function outputUrl(permit: MediaProbePermit) {
  await checkProbeExecution(
    permit,
    permit.environment,
    permit.owner,
    PROBE_MODEL,
  );
  const output = await probeDatabase(
    permit.environment.DB.prepare(
      "SELECT url,observed_at FROM media_probe_output WHERE job_id=?",
    )
      .bind(permit.jobId)
      .first<{ url: string; observed_at: number }>(),
  );
  if (!output) throw new ApiError(409, "media_probe_output_unavailable");
  return { ...output, url: privateImageUrl(output.url) };
}
async function token(
  permit: MediaProbePermit,
  transport: typeof fetch,
  clock = OBSERVATION_CLOCK,
) {
  await reserveProbeCall(permit, "token");
  const data = TOKEN_SCHEMA.safeParse(
    await responseJson(
      await boundedFetch(transport, TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Key ${permit.environment.FAL_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiration_seconds: 300 }),
      }),
    ),
  );
  if (!data.success) throw new ApiError(502, "media_probe_observation_unknown");
  const expiresAt =
    typeof data.data.expires_at === "string"
      ? Date.parse(data.data.expires_at)
      : data.data.expires_at * 1000;
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= clock.now() ||
    expiresAt > clock.now() + 305000
  )
    throw new ApiError(502, "media_probe_observation_unknown");
  return { value: data.data.token, expiresAt };
}
async function observeFile(
  permit: MediaProbePermit,
  url: string,
  transport: typeof fetch,
  credential?: string,
  signal?: AbortSignal,
) {
  await reserveProbeCall(permit, credential ? "diagnostic" : "anonymous");
  const response = await boundedFetch(transport, url, {
    signal,
    headers: credential ? { Authorization: `Bearer ${credential}` } : {},
  });
  const status = response.status;
  await response.body?.cancel().catch(() => {});
  return status;
}
export async function diagnoseProbeAcl(
  permit: MediaProbePermit,
  transport: typeof fetch = fetch,
) {
  try {
    const output = await outputUrl(permit);
    await reserveProbeCall(permit, "acl");
    const url = new URL("https://rest.fal.ai/storage/files/acl");
    url.searchParams.set("url", output.url);
    const acl = z
      .object({
        default: z.enum(["allow", "forbid", "hide"]),
        rules: z.array(z.unknown()),
      })
      .safeParse(
        await responseJson(
          await boundedFetch(transport, url.href, {
            headers: { Authorization: `Key ${permit.environment.FAL_KEY}` },
          }),
        ),
      );
    if (!acl.success)
      throw new ApiError(502, "media_probe_observation_unknown");
    const verdict =
      acl.data.default === "forbid" && acl.data.rules.length === 0
        ? "pass"
        : "fail";
    await recordProbeEvidence(permit, "acl", verdict);
    const status = await observeFile(permit, output.url, transport);
    const anonymous =
      status === 403
        ? "pass"
        : status === 200 || status === 206
          ? "fail"
          : "unknown";
    await recordProbeEvidence(permit, "anonymous", anonymous);
    return { acl: verdict, anonymous };
  } catch {
    await recordProbeEvidence(permit, "acl", "unknown").catch(() => {});
    throw new ApiError(502, "media_probe_observation_unknown");
  }
}
/** tokenはこの診断のメモリだけ。中断時はunknownを残し、再発行で試験を救済しない。 */
export async function observeProbeToken(
  permit: MediaProbePermit,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
  clock = OBSERVATION_CLOCK,
) {
  try {
    await reserveProbeCall(permit, "token_observation");
    const output = await outputUrl(permit),
      credential = await token(permit, transport, clock);
    // 回収adapterが期限前の所有者正常取得を検証済みであることを要求。
    const stored = await probeDatabase(
      permit.environment.DB.prepare(
        "SELECT 1 FROM media_output_objects WHERE job_id=? AND state='stored'",
      )
        .bind(permit.jobId)
        .first(),
    );
    if (!stored) throw new ApiError(409, "media_probe_output_unavailable");
    if (
      (await observeFile(
        permit,
        output.url,
        transport,
        credential.value,
        signal,
      )) !== 200
    ) {
      await recordProbeEvidence(
        permit,
        "token",
        "unknown",
        "initial_owner_unreadable",
      );
      return { token: "unknown" };
    }
    await clock.sleep(credential.expiresAt - clock.now() + 1000, signal);
    const expiredStatus = await observeFile(
      permit,
      output.url,
      transport,
      credential.value,
      signal,
    );
    const current = await token(permit, transport, clock);
    const currentStatus = await observeFile(
      permit,
      output.url,
      transport,
      current.value,
      signal,
    );
    let reason: ProbeDiagnosticReason | null = null;
    if (currentStatus !== 200) reason = "fresh_token_unreadable";
    else if (expiredStatus === 200 || expiredStatus === 206)
      reason = "expired_token_readable";
    else if (expiredStatus !== 401 && expiredStatus !== 403)
      reason = "expired_token_other";
    const verdict = reason === null ? "pass" : "unknown";
    await recordProbeEvidence(permit, "token", verdict, reason);
    return { token: verdict };
  } catch {
    await recordProbeEvidence(
      permit,
      "token",
      "unknown",
      "observation_error",
    ).catch(() => {});
    throw new ApiError(502, "media_probe_observation_unknown");
  }
}
export async function observeProbeExpiry(
  permit: MediaProbePermit,
  transport: typeof fetch = fetch,
  clock = OBSERVATION_CLOCK,
) {
  try {
    const output = await outputUrl(permit);
    if (clock.now() < output.observed_at + 3600000) {
      await recordProbeEvidence(permit, "expiry", "not_due");
      return { expiry: "not_due" };
    }
    await reserveProbeCall(permit, "expiry_observation");
    const credential = await token(permit, transport, clock);
    const status = await observeFile(
      permit,
      output.url,
      transport,
      credential.value,
    );
    let reason: ProbeDiagnosticReason | null = null;
    if (status === 200 || status === 206) reason = "media_still_readable";
    else if (status === 401 || status === 403) reason = "owner_token_denied";
    else if (status !== 404 && status !== 410) reason = "other_response";
    const verdict =
      reason === null
        ? "pass"
        : reason === "media_still_readable"
          ? "fail"
          : "unknown";
    await recordProbeEvidence(permit, "expiry", verdict, reason);
    return { expiry: verdict };
  } catch {
    await recordProbeEvidence(
      permit,
      "expiry",
      "unknown",
      "observation_error",
    ).catch(() => {});
    throw new ApiError(502, "media_probe_observation_unknown");
  }
}
