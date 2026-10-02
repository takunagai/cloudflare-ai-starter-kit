import { z } from "zod";
import {
  checkExtensionRuntimePolicy,
  requireExtensionEnabled,
} from "../ai-verification";
import type { AppEnv, Identity } from "../env";
import { ApiError } from "../http";
import { digest } from "./rag";

export const imageInputSchema = z.strictObject({
  requestId: z.uuid(),
  model: z.literal("fal-ai/flux/schnell"),
  prompt: z.string().trim().min(1).max(2_000),
  size: z.enum(["square", "square_hd"]).default("square"),
});
type ImageInput = z.infer<typeof imageInputSchema>;
interface ImageJob {
  id: string;
  owner_id: string;
  input_hash: string;
  provider_id: string | null;
  provider_urls_json: string | null;
  state: string;
  result_json: string | null;
  created_at: number;
}
interface ProviderUrls {
  status: string;
  result: string;
  cancel: string;
}
const terminalStates = ["completed", "failed", "submission_unknown"];

function imageKey(env: AppEnv) {
  requireExtensionEnabled(env, env.ENABLE_IMAGES);
  if (!env.FAL_KEY) throw new ApiError(503, "IMAGES_NOT_CONFIGURED");
  return env.FAL_KEY;
}

function present(job: ImageJob) {
  return {
    id: job.id,
    state: job.state,
    createdAt: job.created_at,
    image: job.result_json ? (JSON.parse(job.result_json) as unknown) : null,
  };
}

function endpoint(value: string, id: string, kind: keyof ProviderUrls) {
  const url = new URL(value);
  const tail =
    kind === "status"
      ? "/status"
      : kind === "cancel"
        ? "/cancel"
        : "(?:/response)?";
  const validPath = new RegExp(
    `^/fal-ai/flux(?:/schnell)?/requests/${id}${tail}$`,
  );
  if (
    url.origin !== "https://queue.fal.run" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !validPath.test(url.pathname)
  ) {
    throw new ApiError(502, "IMAGE_PROVIDER_RESPONSE_INVALID");
  }
  return url.href;
}

async function providerRequest(
  url: string,
  key: string,
  method: string,
  fetcher: typeof fetch,
  body?: unknown,
) {
  try {
    return await fetcher(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
        "X-Fal-Request-Timeout": "120",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(502, "IMAGE_PROVIDER_UNAVAILABLE");
  }
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const decoder = new TextDecoder();
    let body = "";
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new Error();
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } catch {
    throw new ApiError(502, "IMAGE_PROVIDER_RESPONSE_INVALID");
  }
}

export async function submitImage(
  env: AppEnv,
  identity: Identity,
  input: ImageInput,
  fetcher: typeof fetch = fetch,
) {
  requireExtensionEnabled(env, env.ENABLE_IMAGES);
  const parsed = imageInputSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_INPUT");
  input = parsed.data;
  const hash = await digest(
    JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      size: input.size,
    }),
  );
  const existing = await env.DB.prepare(
    "SELECT * FROM image_jobs WHERE owner_id = ? AND request_key = ?",
  )
    .bind(identity.id, input.requestId)
    .first<ImageJob>();
  if (existing) {
    if (existing.input_hash !== hash)
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
    await checkExtensionRuntimePolicy(env);
    return present(existing);
  }
  await checkExtensionRuntimePolicy(env);
  const key = imageKey(env);
  const id = crypto.randomUUID();
  const now = Date.now();
  // The quota check and reservation share one SQL statement. Concurrent clients
  // cannot make both a successful quota check and an unreserved paid submission.
  const reserved = await env.DB.prepare(
    `INSERT OR IGNORE INTO image_jobs (id, owner_id, request_key, input_hash, model, state, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, 'submitting', ?, ?
     WHERE (SELECT COUNT(*) FROM image_jobs WHERE owner_id = ? AND created_at >= ?) < 10
       AND (SELECT COUNT(*) FROM image_jobs WHERE owner_id = ? AND state IN ('submitting','queued','running','submission_unknown','cancel_requested','timed_out')) < 1`,
  )
    .bind(
      id,
      identity.id,
      input.requestId,
      hash,
      input.model,
      now,
      now,
      identity.id,
      now - 86_400_000,
      identity.id,
    )
    .run();
  if (!reserved.meta.changes) {
    const duplicate = await env.DB.prepare(
      "SELECT * FROM image_jobs WHERE owner_id = ? AND request_key = ?",
    )
      .bind(identity.id, input.requestId)
      .first<ImageJob>();
    if (duplicate) {
      if (duplicate.input_hash !== hash)
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
      return present(duplicate);
    }
    throw new ApiError(429, "IMAGE_LIMIT_REACHED");
  }
  let dispatched = false;
  try {
    await checkExtensionRuntimePolicy(env);
    dispatched = true;
    const response = await providerRequest(
      `https://queue.fal.run/${input.model}`,
      key,
      "POST",
      fetcher,
      {
        prompt: input.prompt,
        image_size: input.size,
        num_images: 1,
        num_inference_steps: 4,
        enable_safety_checker: true,
        output_format: "png",
      },
    );
    if (!response.ok) {
      // A lost/5xx acknowledgement cannot prove that no paid job was accepted.
      const state = response.status >= 500 ? "submission_unknown" : "failed";
      await env.DB.prepare(
        "UPDATE image_jobs SET state = ?, updated_at = ? WHERE id = ?",
      )
        .bind(state, Date.now(), id)
        .run();
      throw new ApiError(502, "IMAGE_SUBMISSION_FAILED");
    }
    const parsed = z
      .object({
        request_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
        status_url: z.url(),
        response_url: z.url(),
        cancel_url: z.url(),
      })
      .safeParse(await responseBody(response));
    if (!parsed.success)
      throw new ApiError(502, "IMAGE_PROVIDER_RESPONSE_INVALID");
    const data = parsed.data;
    const urls: ProviderUrls = {
      status: endpoint(data.status_url, data.request_id, "status"),
      result: endpoint(data.response_url, data.request_id, "result"),
      cancel: endpoint(data.cancel_url, data.request_id, "cancel"),
    };
    await checkExtensionRuntimePolicy(env);
    await env.DB.prepare(
      "UPDATE image_jobs SET provider_id = ?, provider_urls_json = ?, state = 'queued', updated_at = ? WHERE id = ?",
    )
      .bind(data.request_id, JSON.stringify(urls), Date.now(), id)
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE image_jobs SET state = ?, updated_at = ? WHERE id = ? AND state = 'submitting'",
    )
      .bind(dispatched ? "submission_unknown" : "failed", Date.now(), id)
      .run();
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "IMAGE_SUBMISSION_UNKNOWN");
  }
  return present(await findJob(env, identity, id));
}

async function findJob(env: AppEnv, identity: Identity, id: string) {
  const job = await env.DB.prepare(
    "SELECT * FROM image_jobs WHERE id = ? AND owner_id = ?",
  )
    .bind(id, identity.id)
    .first<ImageJob>();
  if (!job) throw new ApiError(404, "NOT_FOUND");
  return job;
}

export async function listImages(env: AppEnv, identity: Identity) {
  requireExtensionEnabled(env, env.ENABLE_IMAGES);
  await checkExtensionRuntimePolicy(env);
  imageKey(env);
  const rows = await env.DB.prepare(
    "SELECT * FROM image_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(identity.id)
    .all<ImageJob>();
  return { jobs: rows.results.map(present) };
}

export async function getImage(
  env: AppEnv,
  identity: Identity,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  requireExtensionEnabled(env, env.ENABLE_IMAGES);
  const job = await findJob(env, identity, id);
  await checkExtensionRuntimePolicy(env);
  const key = imageKey(env);
  if (
    terminalStates.includes(job.state) ||
    !job.provider_id ||
    !job.provider_urls_json
  )
    return present(job);
  const urls = JSON.parse(job.provider_urls_json) as ProviderUrls;
  const response = await providerRequest(
    endpoint(urls.status, job.provider_id, "status"),
    key,
    "GET",
    fetcher,
  );
  if (!response.ok) throw new ApiError(502, "IMAGE_STATUS_FAILED");
  const parsed = z
    .object({
      status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
      error: z.unknown().optional(),
    })
    .safeParse(await responseBody(response));
  if (!parsed.success)
    throw new ApiError(502, "IMAGE_PROVIDER_RESPONSE_INVALID");
  let next: string = parsed.data.status === "IN_QUEUE" ? "queued" : "running";
  let image: { url: string; width: number; height: number } | null = null;
  if (parsed.data.status === "COMPLETED") {
    if (parsed.data.error) next = "failed";
    else {
      await checkExtensionRuntimePolicy(env);
      const result = await providerRequest(
        endpoint(urls.result, job.provider_id, "result"),
        key,
        "GET",
        fetcher,
      );
      if (result.status >= 500 || result.status === 429)
        throw new ApiError(502, "IMAGE_RESULT_UNAVAILABLE");
      if (!result.ok) next = "failed";
      else {
        const parsedImage = z
          .object({
            images: z
              .array(
                z.object({
                  url: z.url(),
                  width: z.number().int().min(1).max(1024),
                  height: z.number().int().min(1).max(1024),
                }),
              )
              .length(1),
          })
          .safeParse(await responseBody(result));
        if (!parsedImage.success)
          throw new ApiError(502, "IMAGE_PROVIDER_RESPONSE_INVALID");
        const candidate = parsedImage.data.images[0];
        const imageUrl = new URL(candidate.url);
        if (
          imageUrl.protocol !== "https:" ||
          imageUrl.username ||
          imageUrl.password ||
          !(
            imageUrl.hostname === "fal.media" ||
            imageUrl.hostname.endsWith(".fal.media")
          )
        ) {
          throw new ApiError(502, "IMAGE_PROVIDER_RESPONSE_INVALID");
        }
        image = candidate;
        next = "completed";
      }
    }
  } else if (job.state === "cancel_requested") next = "cancel_requested";
  else if (Date.now() - job.created_at > 600_000) next = "timed_out";
  await checkExtensionRuntimePolicy(env);
  await env.DB.prepare(
    `UPDATE image_jobs SET state = CASE
       WHEN state = 'cancel_requested' AND ? IN ('queued','running','timed_out') THEN state
       ELSE ? END,
     result_json = ?, updated_at = ? WHERE id = ? AND state NOT IN ('completed','failed')`,
  )
    .bind(next, next, image ? JSON.stringify(image) : null, Date.now(), id)
    .run();
  return present(await findJob(env, identity, id));
}

export async function cancelImage(
  env: AppEnv,
  identity: Identity,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  requireExtensionEnabled(env, env.ENABLE_IMAGES);
  const job = await findJob(env, identity, id);
  if (terminalStates.includes(job.state))
    throw new ApiError(409, "IMAGE_NOT_CANCELLABLE");
  if (!job.provider_id || !job.provider_urls_json)
    throw new ApiError(409, "IMAGE_SUBMISSION_PENDING");
  await checkExtensionRuntimePolicy(env);
  const key = imageKey(env);
  if (job.state === "cancel_requested") return present(job);
  const urls = JSON.parse(job.provider_urls_json) as ProviderUrls;
  const response = await providerRequest(
    endpoint(urls.cancel, job.provider_id, "cancel"),
    key,
    "PUT",
    fetcher,
  );
  if (response.status === 400) return getImage(env, identity, id, fetcher);
  if (response.status !== 202) throw new ApiError(502, "IMAGE_CANCEL_FAILED");
  await checkExtensionRuntimePolicy(env);
  await env.DB.prepare(
    "UPDATE image_jobs SET state = 'cancel_requested', updated_at = ? WHERE id = ? AND state NOT IN ('completed','failed')",
  )
    .bind(Date.now(), id)
    .run();
  // Acceptance is not proof that inference stopped; polling may still complete.
  return present(await findJob(env, identity, id));
}
