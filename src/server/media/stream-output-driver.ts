import { z } from "zod";
import { ApiError } from "../http";
import { MEDIA_LIMITS, type NormalizedMedia } from "./catalog";
import { createReferenceGrants } from "./grants";
import { privateImageUrl, queueUrl, responseJson } from "./image-driver";
import { boundedBytes } from "./image-inspection";
import { type MediaJob, mediaDatabase, ownedMediaJob } from "./ledger";
import { type MediaEnv, requireMediaBucket } from "./policy";
import type { MediaDriver, MediaReceipt } from "./service";
export type StreamOutputSpecification = {
  endpoints: readonly string[];
  field: "video" | "audio";
  maximumBytes: number;
  invalidCode: string;
  writeUnknownCode: string;
  isReady: (env: MediaEnv, id: string) => boolean;
  providerInput: (
    media: NormalizedMedia,
    grants: { role: string; ordinal: number; url: string }[],
  ) => unknown;
  mime: (input: { format?: string }) => string;
  inspect: (
    read: (offset: number, count: number) => Promise<Uint8Array<ArrayBuffer>>,
    length: number,
    input: {
      duration: number;
      resolution: string;
      aspectRatio?: string;
      format?: string;
    },
    canvas?: { width: number; height: number },
  ) => Promise<
    Omit<MediaReceipt, "id" | "ordinal" | "objectKey" | "validatedAt">
  >;
};
type OutputObject = {
  asset_id: string;
  object_key: string;
  state: string;
  receipt_json: string | null;
};

/** transportは内部の合成試験だけ。公開APIからは注入しない。 */
export function createStreamOutputDriver(
  env: MediaEnv,
  specification: StreamOutputSpecification,
  transport: typeof fetch = fetch,
): MediaDriver {
  const guard = (id: string) => {
    if (!specification.endpoints.some((endpoint) => endpoint === id))
      throw new ApiError(503, "media_adapter_not_ready");
    if (!specification.isReady(env, id))
      throw new ApiError(503, "media_upstream_unverified");
  };
  const call = async (
    url: string,
    signal: AbortSignal,
    method = "GET",
    body?: unknown,
    headers?: HeadersInit,
  ) =>
    transport(url, {
      method,
      signal,
      redirect: "error",
      headers: {
        Authorization: `Key ${env.FAL_KEY}`,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const queue = (job: Readonly<MediaJob>, operation = "") =>
    queueUrl(job, operation, specification.endpoints);
  return {
    assertReady: guard,
    async submit(media, context) {
      guard(media.model.id);
      const owner = await mediaDatabase(
        env.DB.prepare("SELECT owner_id FROM media_jobs WHERE id=?")
          .bind(context.jobId)
          .first<{ owner_id: string }>(),
      );
      if (!owner) throw new ApiError(404, "not_found");
      const grants = await createReferenceGrants(
        env,
        owner.owner_id,
        context.jobId,
      );
      context.signal.throwIfAborted();
      const result = z
        .object({ request_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) })
        .safeParse(
          await responseJson(
            await call(
              `https://queue.fal.run/${media.model.id}`,
              context.signal,
              "POST",
              specification.providerInput(media, grants),
              context.headers,
            ),
          ),
        );
      if (!result.success)
        throw new ApiError(502, "media_provider_response_invalid");
      return { outcome: "accepted", requestId: result.data.request_id };
    },
    async status(job, signal) {
      guard(job.model_id);
      const result = z
        .object({
          status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
          error: z.unknown().optional(),
        })
        .safeParse(
          await responseJson(await call(queue(job, "/status"), signal)),
        );
      if (!result.success)
        throw new ApiError(502, "media_provider_response_invalid");
      return result.data.status === "IN_QUEUE"
        ? "queued"
        : result.data.status === "IN_PROGRESS"
          ? "running"
          : result.data.error != null
            ? "failed"
            : "completed";
    },
    async cancel(job, signal) {
      guard(job.model_id);
      const response = await call(queue(job, "/cancel"), signal, "PUT");
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new ApiError(502, "media_provider_unavailable");
    },
    async collect(job, signal) {
      guard(job.model_id);
      const bucket = requireMediaBucket(env);
      if (Date.now() >= job.created_at + MEDIA_LIMITS.monitorMs)
        throw new ApiError(502, "media_output_expired");
      const existing = await mediaDatabase(
        env.DB.prepare(
          "SELECT * FROM media_output_objects WHERE job_id=? AND ordinal=0",
        )
          .bind(job.id)
          .first<OutputObject>(),
      );
      if (existing) {
        if (existing.state !== "stored" || !existing.receipt_json)
          throw new ApiError(502, "media_collection_unavailable");
        const receipt = JSON.parse(existing.receipt_json) as MediaReceipt;
        const object = await bucket.head(existing.object_key);
        if (!object || object.size !== receipt.bytes)
          throw new ApiError(502, "media_collection_unavailable");
        return { assets: [receipt], isComplete: true, hasInvalidOutput: false };
      }
      const raw = z
        .object({
          [specification.field]: z.object({
            url: z.string(),
            content_type: z.string().nullable().optional(),
            file_size: z
              .number()
              .int()
              .positive()
              .max(specification.maximumBytes)
              .nullable()
              .optional(),
          }),
        })
        .safeParse(await responseJson(await call(queue(job), signal)));
      const invalidOutput = () => ({
        assets: [],
        isComplete: false,
        hasInvalidOutput: true,
      });
      if (!raw.success) return invalidOutput();
      let url: string;
      try {
        url = privateImageUrl(raw.data[specification.field].url);
      } catch {
        return invalidOutput();
      }
      const body = await mediaDatabase(
        env.DB.prepare(
          "SELECT input_json FROM media_job_bodies WHERE job_id=? AND owner_id=?",
        )
          .bind(job.id, job.owner_id)
          .first<{ input_json: string }>(),
      );
      if (!body) throw new ApiError(409, "media_body_unavailable");
      const input = JSON.parse(body.input_json) as {
        duration: number;
        resolution: string;
        aspectRatio?: string;
        format?: string;
      };
      const canvas = await mediaDatabase(
        env.DB.prepare(
          "SELECT a.width,a.height FROM media_assets a JOIN media_job_assets l ON a.id=l.asset_id AND a.owner_id=l.owner_id WHERE l.job_id=? AND l.role IN ('start','end') ORDER BY CASE l.role WHEN 'start' THEN 0 ELSE 1 END LIMIT 1",
        )
          .bind(job.id)
          .first<{ width: number; height: number }>(),
      );
      const mime = specification.mime(input);
      if (
        raw.data[specification.field].content_type != null &&
        raw.data[specification.field].content_type !== mime
      )
        return invalidOutput();
      const auth = z
        .object({
          token: z.string().min(1).max(4096),
          expires_at: z.union([z.string(), z.number()]),
        })
        .safeParse(
          await responseJson(
            await call(
              "https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3",
              signal,
              "POST",
              { expiration_seconds: 300 },
            ),
          ),
        );
      if (!auth.success)
        throw new ApiError(502, "media_provider_response_invalid");
      const expiry =
        typeof auth.data.expires_at === "string"
          ? Date.parse(auth.data.expires_at)
          : auth.data.expires_at * 1000;
      if (
        !Number.isFinite(expiry) ||
        expiry <= Date.now() ||
        expiry > Date.now() + 305000
      )
        throw new ApiError(502, "media_provider_response_invalid");
      const response = await transport(url, {
        signal,
        redirect: "error",
        headers: { Authorization: `Bearer ${auth.data.token}` },
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ApiError(502, "media_collection_unavailable");
      }
      const contentLength = response.headers.get("Content-Length"),
        declared = raw.data[specification.field].file_size;
      const length =
        contentLength !== null && /^\d+$/.test(contentLength)
          ? Number(contentLength)
          : declared;
      if (
        response.headers.get("Content-Type")?.split(";")[0] !== mime ||
        (response.headers.get("Content-Encoding") &&
          response.headers.get("Content-Encoding") !== "identity") ||
        (contentLength !== null && !/^\d+$/.test(contentLength)) ||
        !length ||
        !Number.isSafeInteger(length) ||
        length > specification.maximumBytes ||
        (declared != null && declared !== length) ||
        !response.body
      ) {
        await response.body?.cancel().catch(() => {});
        return invalidOutput();
      }
      const id = crypto.randomUUID(),
        objectKey = `media/results/${job.id}/0`;
      const claim = await mediaDatabase(
        env.DB.prepare(
          "INSERT INTO media_output_objects SELECT id,owner_id,0,?,?,'writing',NULL,? FROM media_jobs WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND terminal_at IS NULL AND cancel_requested_at IS NULL AND body_erased_at IS NULL AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0 ON CONFLICT(job_id,ordinal) DO NOTHING",
        )
          .bind(
            id,
            objectKey,
            Date.now(),
            job.id,
            job.owner_id,
            job.lease_token,
            Date.now(),
          )
          .run(),
      );
      if (claim.meta.changes !== 1) {
        await response.body.cancel();
        throw new ApiError(409, "media_collection_unavailable");
      }
      let hasConfirmedWrite = false;
      try {
        const source = response.body.getReader(),
          fixed = new FixedLengthStream(length),
          writer = fixed.writable.getWriter();
        const stop = async () => {
          await Promise.allSettled([source.cancel(), writer.abort()]);
        };
        const abort = () => {
          void stop();
        };
        signal.addEventListener("abort", abort, { once: true });
        const writing = bucket
          .put(objectKey, fixed.readable, {
            onlyIf: { etagDoesNotMatch: "*" },
            httpMetadata: {
              contentType: mime,
              cacheControl: "private, no-store",
            },
          })
          .catch(async () => {
            await stop();
            throw new ApiError(502, specification.writeUnknownCode);
          });
        const pumping = (async () => {
          let count = 0;
          try {
            for (;;) {
              signal.throwIfAborted();
              const part = await source.read();
              if (part.done) break;
              count += part.value.length;
              if (count > length || count > specification.maximumBytes)
                throw new ApiError(502, specification.invalidCode);
              await writer.write(part.value);
            }
            if (count !== length)
              throw new ApiError(502, specification.invalidCode);
            await writer.close();
          } catch (error) {
            await stop();
            throw error;
          }
        })();
        const results = await Promise.allSettled([writing, pumping]);
        signal.removeEventListener("abort", abort);
        source.releaseLock();
        writer.releaseLock();
        if (results[0].status !== "fulfilled" || !results[0].value)
          throw new ApiError(502, specification.writeUnknownCode);
        hasConfirmedWrite = true;
        if (results[1].status === "rejected") throw results[1].reason;
        if (results[0].value.size !== length)
          throw new ApiError(502, specification.invalidCode);
        const media = await specification.inspect(
          async (offset, count) => {
            signal.throwIfAborted();
            const object = await bucket.get(objectKey, {
              range: { offset, length: count },
            });
            if (!object) throw new ApiError(502, "media_storage_unavailable");
            const bytes = await boundedBytes(object.body, count, signal);
            if (bytes.length !== count)
              throw new ApiError(502, specification.invalidCode);
            return bytes;
          },
          length,
          input,
          canvas ?? undefined,
        );
        signal.throwIfAborted();
        const receipt: MediaReceipt = {
          id,
          ordinal: 0,
          objectKey,
          ...media,
          validatedAt: Date.now(),
        };
        const current = await ownedMediaJob(env.DB, job.owner_id, job.id);
        if (
          current.cancel_requested_at !== null ||
          current.body_erased_at !== null ||
          current.lease_token !== job.lease_token ||
          (current.lease_until ?? 0) <= Date.now()
        )
          throw new ApiError(409, "media_collection_unavailable");
        const settled = await mediaDatabase(
          env.DB.prepare(
            "UPDATE media_output_objects SET state='stored',receipt_json=? WHERE job_id=? AND ordinal=0 AND state='writing' AND EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND lease_token=? AND lease_until>? AND cancel_requested_at IS NULL AND body_erased_at IS NULL AND terminal_at IS NULL) AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0",
          )
            .bind(
              JSON.stringify(receipt),
              job.id,
              job.id,
              job.lease_token,
              Date.now(),
            )
            .run(),
        );
        if (settled.meta.changes !== 1)
          throw new ApiError(409, "media_collection_unavailable");
        return { assets: [receipt], isComplete: true, hasInvalidOutput: false };
      } catch (error) {
        await mediaDatabase(
          env.DB.prepare(
            "UPDATE media_output_objects SET state=? WHERE job_id=? AND ordinal=0 AND state='writing'",
          )
            .bind(hasConfirmedWrite ? "deleting" : "write_unknown", job.id)
            .run(),
        );
        if (
          hasConfirmedWrite &&
          error instanceof ApiError &&
          error.code === specification.invalidCode
        )
          return invalidOutput();
        throw error;
      }
    },
    async discard(job, signal) {
      const bucket = requireMediaBucket(env);
      const objects = await mediaDatabase(
        env.DB.prepare(
          "SELECT * FROM media_output_objects WHERE job_id=? AND owner_id=?",
        )
          .bind(job.id, job.owner_id)
          .all<OutputObject>(),
      );
      if (
        objects.results.some((object) =>
          ["writing", "write_unknown"].includes(object.state),
        )
      )
        throw new ApiError(502, "media_delete_pending");
      for (const object of objects.results) {
        signal.throwIfAborted();
        await bucket.delete(object.object_key);
        if (await bucket.head(object.object_key))
          throw new ApiError(502, "media_delete_pending");
        await mediaDatabase(
          env.DB.prepare(
            "UPDATE media_output_objects SET state='deleted' WHERE job_id=? AND ordinal=0 AND state NOT IN ('writing','write_unknown')",
          )
            .bind(job.id)
            .run(),
        );
      }
    },
  };
}
