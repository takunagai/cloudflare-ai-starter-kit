import { z } from "zod";
import type { Identity } from "../env";
import { ApiError, errorResponse, json, readJson } from "../http";
import { deleteAsset } from "./assets";
import { createImageDriver, queueUrl, responseJson } from "./image-driver";
import { ownedMediaJob } from "./ledger";
import type { MediaEnv } from "./policy";
import {
  diagnoseProbeAcl,
  observeProbeExpiry,
  observeProbeToken,
  type ProbeObservationClock,
} from "./probe-diagnostics";
import {
  authorizeMediaProbe,
  closeMediaProbe,
  PROBE_MODEL,
  probeDatabase,
  probeInput,
  readProbeRun,
  recordProbeEvidence,
  reserveProbeCall,
  stopMediaProbe,
} from "./probe-permit";
import { eraseMediaBody } from "./retention";
import {
  advanceMediaJob,
  getMediaJob,
  requestMediaCancellation,
  submitMedia,
} from "./service";

const SUBMIT_SCHEMA = z.strictObject({
  slot: z.literal(1),
  requestId: z.string().regex(/^\d{4}-\d{2}-\d{2}:[a-f0-9-]{36}$/),
});
const REPORT_SCHEMA = z.strictObject({
  item: z.enum(["quality", "billing", "upstream_delete"]),
  verdict: z.enum(["pass", "fail", "unknown"]),
});
async function state(environment: MediaEnv, identity: Identity) {
  const run = await readProbeRun(environment, identity.id);
  const slot = await probeDatabase(
    environment.DB.prepare(
      "SELECT request_key FROM media_probe_slots WHERE run_id=1 AND slot=1",
    ).first<{ request_key: string }>(),
  );
  const attempt = await probeDatabase(
    environment.DB.prepare(
      "SELECT job_id,invalid_reason FROM media_probe_attempts WHERE owner_id=?",
    )
      .bind(identity.id)
      .first<{ job_id: string; invalid_reason: string | null }>(),
  );
  const detail = attempt
    ? await getMediaJob(environment, identity, attempt.job_id)
    : null;
  const evidence = attempt
    ? await probeDatabase(
        environment.DB.prepare(
          "SELECT item,verdict,observed_at,diagnostic_reason FROM media_probe_evidence WHERE job_id=? ORDER BY item",
        )
          .bind(attempt.job_id)
          .all<{
            item: string;
            verdict: string;
            observed_at: number;
            diagnostic_reason: string | null;
          }>(),
      )
    : null;
  return {
    model: PROBE_MODEL,
    slot: 1,
    requestId: slot?.request_key ?? null,
    startedAt: run.started_at,
    expiresAt: run.expires_at,
    usedAttempts: run.used_attempts,
    maximumAttempts: run.max_attempts,
    authorizedAttempts: 1,
    canSubmit:
      !!slot &&
      run.used_attempts === 0 &&
      run.is_stopped === 0 &&
      run.started_at <= run.database_now &&
      run.expires_at > run.database_now + 15000,
    isStopped:
      run.is_stopped === 1 ||
      run.used_attempts > 0 ||
      run.database_now >= run.expires_at,
    reconciliationUntil: (run.stopped_at ?? run.expires_at) + 86400000,
    job: detail
      ? {
          id: detail.id,
          providerState: detail.providerState,
          collectionState: detail.collectionState,
          terminalOutcome: detail.terminalOutcome,
          invalidReason: attempt?.invalid_reason ?? null,
          isUncertain: detail.isUncertain,
          assets: detail.assets,
        }
      : null,
    evidence: evidence?.results ?? [],
  };
}
/** 通常API/driver注入を使わない、本人と固定manifestだけの専用経路。 */
export async function handleMediaProbe(
  request: Request,
  environment: MediaEnv,
  identity: Identity,
  observationClock?: ProbeObservationClock,
) {
  const path = new URL(request.url).pathname;
  const response = (body: unknown, status = 200) =>
    json(body, status, { "Cache-Control": "private, no-store" });
  if (path === "/api/media-probe") {
    if (request.method !== "GET") throw new ApiError(405, "method_not_allowed");
    return response(await state(environment, identity));
  }
  if (["/api/media-probe/stop", "/api/media-probe/close"].includes(path)) {
    if (request.method !== "POST")
      throw new ApiError(405, "method_not_allowed");
    await readJson(request, z.strictObject({}), 1024, true);
    if (path.endsWith("/close"))
      return response(await closeMediaProbe(environment, identity.id));
    await stopMediaProbe(environment, identity.id);
    return response({ isStopped: true });
  }
  if (path === "/api/media-probe/jobs") {
    if (request.method !== "POST")
      throw new ApiError(405, "method_not_allowed");
    if (
      request.headers.has("Content-Encoding") &&
      request.headers.get("Content-Encoding") !== "identity"
    )
      throw new ApiError(415, "unsupported_media_type");
    const input = await readJson(request, SUBMIT_SCHEMA, 16384, true);
    const permit = await authorizeMediaProbe(
      environment,
      identity,
      input.requestId,
    );
    try {
      const job = await submitMedia(
        {
          env: environment,
          identity,
          probe: permit,
          driver: createImageDriver(environment, fetch, permit),
        },
        probeInput(input.requestId),
      );
      return response(job, 202);
    } catch (error) {
      await stopMediaProbe(environment, identity.id).catch(() => {});
      throw error;
    }
  }
  const match =
    /^\/api\/media-probe\/jobs\/([a-f0-9-]{36})\/(refresh|cleanup-status|cancel|erase-body|acl|token-observation|expiry|report|assets\/[a-f0-9-]{36})$/.exec(
      path,
    );
  if (!match) throw new ApiError(404, "not_found");
  if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
  const job = await ownedMediaJob(environment.DB, identity.id, match[1]);
  const permit = await authorizeMediaProbe(
    environment,
    identity,
    job.request_key,
    job.id,
  );
  const operation = match[2];
  if (operation === "report") {
    const report = await readJson(request, REPORT_SCHEMA, 1024, true);
    await recordProbeEvidence(permit, report.item, report.verdict);
    return response({ isRecorded: true, source: "owner_report" });
  }
  await readJson(request, z.strictObject({}), 1024, true);
  if (operation === "cleanup-status") {
    await reserveProbeCall(permit, "cleanup_status");
    try {
      const status = z
        .object({ status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]) })
        .safeParse(
          await responseJson(
            await fetch(queueUrl(job, "/status"), {
              redirect: "manual",
              signal: AbortSignal.timeout(15000),
              headers: { Authorization: `Key ${environment.FAL_KEY}` },
            }),
          ),
        );
      if (!status.success)
        throw new ApiError(502, "media_probe_observation_unknown");
      return response({ upstreamState: status.data.status });
    } catch {
      throw new ApiError(502, "media_probe_observation_unknown");
    }
  }
  if (operation === "token-observation") {
    const cancellation = new AbortController();
    const signal = AbortSignal.any([
      request.signal,
      cancellation.signal,
      AbortSignal.timeout(345000),
    ]);
    let isCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({ state: "observing" })}\n`,
          ),
        );
        void observeProbeToken(permit, signal, fetch, observationClock)
          .then((result) => {
            if (!isCancelled)
              controller.enqueue(
                new TextEncoder().encode(`${JSON.stringify(result)}\n`),
              );
          })
          .catch(() => {
            if (!isCancelled)
              controller.enqueue(
                new TextEncoder().encode(
                  `${JSON.stringify({ token: "unknown" })}\n`,
                ),
              );
          })
          .finally(() => {
            if (!isCancelled) controller.close();
          });
      },
      cancel() {
        isCancelled = true;
        cancellation.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (operation === "acl") return response(await diagnoseProbeAcl(permit));
  if (operation === "expiry")
    return response(await observeProbeExpiry(permit, fetch, observationClock));
  if (operation === "cancel")
    return response(
      await requestMediaCancellation(environment, identity, job.id),
    );
  if (operation === "erase-body")
    return response({
      isErased: !(await eraseMediaBody(environment, identity, job.id))
        .bodyAvailable,
    });
  if (operation.startsWith("assets/")) {
    const assetId = operation.slice(7);
    const link = await probeDatabase(
      environment.DB.prepare(
        "SELECT 1 FROM media_job_assets WHERE job_id=? AND owner_id=? AND asset_id=? AND role='output'",
      )
        .bind(job.id, identity.id, assetId)
        .first(),
    );
    if (!link) throw new ApiError(404, "not_found");
    return response(await deleteAsset(environment, identity, assetId));
  }
  try {
    const result = await advanceMediaJob(
      {
        env: environment,
        identity,
        probe: permit,
        driver: createImageDriver(environment, fetch, permit),
      },
      job.id,
    );
    await probeDatabase(
      environment.DB.prepare(
        "UPDATE media_probe_attempts SET terminal_at=(SELECT terminal_at FROM media_jobs WHERE id=? AND owner_id=?) WHERE job_id=? AND owner_id=? AND terminal_at IS NULL",
      )
        .bind(job.id, identity.id, job.id, identity.id)
        .run(),
    );
    return response(result);
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "media_probe_call_limit"))
      await stopMediaProbe(environment, identity.id).catch(() => {});
    return errorResponse(error);
  }
}
