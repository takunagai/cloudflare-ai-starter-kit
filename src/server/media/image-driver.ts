import { z } from "zod";
import { ApiError } from "../http";
import { MEDIA_MODEL_IDS, type NormalizedMedia } from "./catalog";
import { createReferenceGrants } from "./grants";
import {
  boundedBytes,
  IMAGE_MIMES,
  imageOperation,
  inspectImage,
} from "./image-inspection";
import { type MediaJob, mediaDatabase, ownedMediaJob } from "./ledger";
import { type MediaEnv, requireMediaBucket } from "./policy";
import type { MediaDriver, MediaReceipt } from "./service";

export const IMAGE_MODEL_IDS = MEDIA_MODEL_IDS.slice(0, 4);
export function verifiedImageModels(env: MediaEnv): string[] {
  try {
    const models: unknown = JSON.parse(env.MEDIA_VERIFIED_IMAGE_MODELS ?? "[]");
    if (
      !Array.isArray(models) ||
      models.some((id) => !IMAGE_MODEL_IDS.includes(id)) ||
      new Set(models).size !== models.length
    )
      return [];
    return models;
  } catch {
    return [];
  }
}
export function imageAdapterReady(env: MediaEnv, id: string) {
  return Boolean(
    env.FAL_KEY &&
      env.MEDIA_BUCKET &&
      env.MEDIA_BUCKET !== env.RAG_BUCKET &&
      verifiedImageModels(env).includes(id),
  );
}
export async function responseJson(response: Response) {
  if (
    !response.ok ||
    response.headers.get("Content-Type")?.split(";")[0] !== "application/json"
  ) {
    await response.body?.cancel().catch(() => {});
    throw new ApiError(502, "media_provider_unavailable");
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedBytes(response.body, 32 * 1024),
      ),
    ) as unknown;
  } catch {
    throw new ApiError(502, "media_provider_response_invalid");
  }
}
export function queueUrl(
  job: Readonly<MediaJob>,
  operation = "",
  allowedModels: readonly string[] = IMAGE_MODEL_IDS,
) {
  if (
    !allowedModels.includes(job.model_id) ||
    !job.provider_id ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(job.provider_id)
  )
    throw new ApiError(400, "media_model_unknown");
  return `https://queue.fal.run/${job.model_id}/requests/${job.provider_id}${operation}`;
}
export function imageProviderInput(
  media: NormalizedMedia,
  grants: { role: string; ordinal: number; url: string }[],
) {
  if (!IMAGE_MODEL_IDS.includes(media.model.id))
    throw new ApiError(400, "media_model_unknown");
  const input = media.input;
  return {
    prompt: input.prompt,
    image_size: input.size,
    quality: input.quality,
    num_images: input.count,
    background: input.background,
    output_format: input.format,
    sync_mode: false,
    ...(input.compression === undefined
      ? {}
      : { output_compression: input.compression }),
    ...(media.model.id.endsWith("/edit")
      ? {
          image_urls: grants
            .filter((grant) => grant.role === "reference")
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((grant) => grant.url),
          ...(input.mask
            ? { mask_url: grants.find((grant) => grant.role === "mask")?.url }
            : {}),
        }
      : {}),
  };
}
const RESULT = z.object({
  images: z
    .array(
      z.object({
        url: z.string(),
        content_type: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        file_size: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(4),
});
export function privateImageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(502, "media_result_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "v3b.fal.media" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/files\/b\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(url.pathname)
  )
    throw new ApiError(502, "media_result_invalid");
  return url.href;
}
interface OutputObject {
  job_id: string;
  ordinal: number;
  asset_id: string;
  object_key: string;
  state: string;
  receipt_json: string | null;
}
/** transportは内部試験のfakeだけ。公開HTTPから注入しない。 */
export function createImageDriver(
  env: MediaEnv,
  transport: typeof fetch = fetch,
): MediaDriver {
  const call = (
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
  const guard = (id: string) => {
    if (!IMAGE_MODEL_IDS.includes(id as (typeof MEDIA_MODEL_IDS)[number]))
      throw new ApiError(503, "media_adapter_not_ready");
    if (!imageAdapterReady(env, id))
      throw new ApiError(503, "media_upstream_unverified");
  };
  return {
    assertReady: guard,
    async submit(media, context) {
      guard(media.model.id);
      const job = await ownedMediaJob(
        env.DB,
        (
          await mediaDatabase(
            env.DB.prepare("SELECT owner_id FROM media_jobs WHERE id=?")
              .bind(context.jobId)
              .first<{ owner_id: string }>(),
          )
        )?.owner_id ?? "",
        context.jobId,
      );
      const grants = await createReferenceGrants(env, job.owner_id, job.id);
      context.signal.throwIfAborted();
      const acknowledgement = z
        .object({ request_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) })
        .safeParse(
          await responseJson(
            await call(
              `https://queue.fal.run/${media.model.id}`,
              context.signal,
              "POST",
              imageProviderInput(media, grants),
              context.headers,
            ),
          ),
        );
      if (!acknowledgement.success)
        throw new ApiError(502, "media_provider_response_invalid");
      return {
        outcome: "accepted",
        requestId: acknowledgement.data.request_id,
      };
    },
    async status(job, signal) {
      guard(job.model_id);
      const result = z
        .object({
          status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
          error: z.unknown().optional(),
        })
        .safeParse(
          await responseJson(await call(queueUrl(job, "/status"), signal)),
        );
      if (!result.success)
        throw new ApiError(502, "media_provider_response_invalid");
      return result.data.status === "IN_QUEUE"
        ? "queued"
        : result.data.status === "IN_PROGRESS"
          ? "running"
          : result.data.error !== undefined && result.data.error !== null
            ? "failed"
            : "completed";
    },
    async cancel(job, signal) {
      guard(job.model_id);
      const response = await call(queueUrl(job, "/cancel"), signal, "PUT");
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new ApiError(502, "media_provider_unavailable");
    },
    async collect(job, signal) {
      guard(job.model_id);
      const bucket = requireMediaBucket(env);
      if (Date.now() >= job.created_at + 3_600_000)
        throw new ApiError(502, "media_output_expired");
      const raw = RESULT.safeParse(
        await responseJson(await call(queueUrl(job), signal)),
      );
      if (!raw.success || raw.data.images.length !== job.quantity)
        return { assets: [], isComplete: false, hasInvalidOutput: true };
      const body = await mediaDatabase(
        env.DB.prepare(
          "SELECT input_json FROM media_job_bodies WHERE job_id=? AND owner_id=?",
        )
          .bind(job.id, job.owner_id)
          .first<{ input_json: string }>(),
      );
      if (!body) throw new ApiError(409, "media_body_unavailable");
      const input = JSON.parse(body.input_json) as {
        format: keyof typeof IMAGE_MIMES;
        size: "auto" | { width: number; height: number };
        background: string;
      };
      let urls: string[];
      try {
        urls = raw.data.images.map((image) => privateImageUrl(image.url));
      } catch {
        return { assets: [], isComplete: false, hasInvalidOutput: true };
      }
      if (new Set(urls).size !== urls.length)
        return { assets: [], isComplete: false, hasInvalidOutput: true };
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
      const tokenExpiry =
        typeof auth.data.expires_at === "string"
          ? Date.parse(auth.data.expires_at)
          : auth.data.expires_at * 1000;
      if (
        !Number.isFinite(tokenExpiry) ||
        tokenExpiry <= Date.now() ||
        tokenExpiry > Date.now() + 305_000
      )
        throw new ApiError(502, "media_provider_response_invalid");
      const receipts: MediaReceipt[] = [];
      for (const [ordinal, url] of urls.entries()) {
        signal.throwIfAborted();
        const existing = await mediaDatabase(
          env.DB.prepare(
            "SELECT * FROM media_output_objects WHERE job_id=? AND ordinal=?",
          )
            .bind(job.id, ordinal)
            .first<OutputObject>(),
        );
        if (existing) {
          if (existing.state !== "stored" || !existing.receipt_json)
            throw new ApiError(502, "media_collection_unavailable");
          const receipt = JSON.parse(existing.receipt_json) as MediaReceipt;
          const object = await bucket.head(existing.object_key);
          if (!object || object.size !== receipt.bytes)
            throw new ApiError(502, "media_collection_unavailable");
          receipts.push(receipt);
          continue;
        }
        try {
          const receipt = await imageOperation(async () => {
            const imageResponse = await transport(url, {
              signal,
              redirect: "error",
              headers: { Authorization: `Bearer ${auth.data.token}` },
            });
            if (
              !imageResponse.ok ||
              (imageResponse.headers.get("Content-Encoding") &&
                imageResponse.headers.get("Content-Encoding") !== "identity")
            ) {
              await imageResponse.body?.cancel().catch(() => {});
              throw new ApiError(502, "media_collection_unavailable");
            }
            const mime =
                imageResponse.headers.get("Content-Type")?.split(";")[0] ?? "",
              length = imageResponse.headers.get("Content-Length");
            if (
              mime !== IMAGE_MIMES[input.format] ||
              (length !== null &&
                (!/^\d+$/.test(length) || Number(length) > 20 * 1024 * 1024))
            ) {
              await imageResponse.body?.cancel().catch(() => {});
              throw new ApiError(502, "media_result_invalid");
            }
            const bytes = await boundedBytes(
              imageResponse.body,
              20 * 1024 * 1024,
              signal,
            );
            const image = await inspectImage(bytes, mime);
            const declared = raw.data.images[ordinal];
            if (
              image.width !== declared.width ||
              declared.content_type !== mime ||
              image.height !== declared.height ||
              (declared.file_size !== undefined &&
                image.bytes !== declared.file_size) ||
              (length !== null && image.bytes !== Number(length)) ||
              (input.size !== "auto" &&
                (image.width !== input.size.width ||
                  image.height !== input.size.height)) ||
              (input.background === "transparent" && !image.hasAlpha)
            )
              throw new ApiError(502, "media_result_invalid");
            const receipt: MediaReceipt = {
              id: crypto.randomUUID(),
              ordinal,
              objectKey: `media/results/${job.id}/${ordinal}`,
              format: image.format,
              bytes: image.bytes,
              width: image.width,
              height: image.height,
              hasAlpha: image.hasAlpha,
              validatedAt: Date.now(),
            };
            // receiptを返す前からobjectの所在/書込み状態を永続化する。
            const claim = await mediaDatabase(
              env.DB.prepare(
                "INSERT INTO media_output_objects SELECT id,owner_id,?,?,?,'writing',NULL,? FROM media_jobs WHERE id=? AND owner_id=? AND lease_token=? AND lease_until>? AND terminal_at IS NULL AND cancel_requested_at IS NULL AND body_erased_at IS NULL AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0 ON CONFLICT(job_id,ordinal) DO NOTHING",
              )
                .bind(
                  ordinal,
                  receipt.id,
                  receipt.objectKey,
                  receipt.validatedAt,
                  job.id,
                  job.owner_id,
                  job.lease_token,
                  Date.now(),
                )
                .run(),
            );
            if (claim.meta.changes !== 1)
              throw new ApiError(409, "media_collection_unavailable");
            let hasStored = false;
            try {
              const object = await bucket.put(receipt.objectKey, bytes, {
                onlyIf: { etagDoesNotMatch: "*" },
                httpMetadata: {
                  contentType: mime,
                  cacheControl: "private, no-store",
                },
              });
              if (!object || object.size !== bytes.length)
                throw new ApiError(502, "media_storage_unavailable");
              hasStored = true;
              signal.throwIfAborted();
              const current = await ownedMediaJob(env.DB, job.owner_id, job.id);
              if (
                current.cancel_requested_at !== null ||
                current.body_erased_at !== null ||
                current.lease_token !== job.lease_token ||
                (current.lease_until ?? 0) <= Date.now()
              )
                throw new ApiError(409, "media_collection_unavailable");
              await mediaDatabase(
                env.DB.prepare(
                  "UPDATE media_output_objects SET state='stored',receipt_json=? WHERE job_id=? AND ordinal=? AND state='writing'",
                )
                  .bind(JSON.stringify(receipt), job.id, ordinal)
                  .run(),
              );
            } catch (error) {
              await mediaDatabase(
                env.DB.prepare(
                  "UPDATE media_output_objects SET state=? WHERE job_id=? AND ordinal=? AND state='writing'",
                )
                  .bind(
                    hasStored ? "deleting" : "write_unknown",
                    job.id,
                    ordinal,
                  )
                  .run(),
              );
              throw error;
            }
            return receipt;
          });
          receipts.push(receipt);
        } catch (error) {
          if (
            error instanceof ApiError &&
            [
              "media_result_invalid",
              "media_image_invalid",
              "media_file_too_large",
            ].includes(error.code)
          )
            return {
              assets: receipts,
              isComplete: false,
              hasInvalidOutput: true,
            };
          // 保存済みreceiptを落とさず、残りだけ同じ要求の回収を試す。
          if (receipts.length)
            return {
              assets: receipts,
              isComplete: false,
              hasInvalidOutput: false,
            };
          throw error;
        }
      }
      return { assets: receipts, isComplete: true, hasInvalidOutput: false };
    },
    async discard(job, signal) {
      signal.throwIfAborted();
      const bucket = requireMediaBucket(env);
      const objects = await mediaDatabase(
        env.DB.prepare(
          "SELECT * FROM media_output_objects WHERE job_id=? AND owner_id=? ORDER BY ordinal",
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
            "UPDATE media_output_objects SET state='deleted' WHERE job_id=? AND ordinal=? AND state NOT IN ('writing','write_unknown')",
          )
            .bind(job.id, object.ordinal)
            .run(),
        );
      }
    },
  };
}
