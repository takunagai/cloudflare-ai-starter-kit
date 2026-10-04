import { z } from "zod";
import type { Identity } from "../env";
import { ApiError, json, readJson } from "../http";
import { handleAssets } from "./assets";
import { MEDIA_CATALOG, MEDIA_LIMITS, mediaRequestSchema } from "./catalog";
import {
  createImageDriver,
  IMAGE_MODEL_IDS,
  imageAdapterReady,
} from "./image-driver";
import { type MediaEnv, requireMediaEnabled } from "./policy";
import { eraseMediaBody } from "./retention";
import {
  advanceMediaJob,
  getMediaJob,
  listMediaJobs,
  type MediaDriver,
  requestMediaCancellation,
  resumeMediaCollection,
  submitMedia,
} from "./service";

export function isMediaCreationPath(path: string, method: string) {
  return (
    path === "/api/media/models" ||
    (path === "/api/media/assets" && method === "POST") ||
    (path.startsWith("/api/media/assets/") && method === "PUT") ||
    (path === "/api/media/jobs" && method === "POST")
  );
}
/** driver引数は内部試験用。公開APIは検証済みの固定画像adapterだけを使う。 */
export async function handleMedia(
  request: Request,
  env: MediaEnv,
  identity: Identity,
  driver?: MediaDriver,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const assetResponse = await handleAssets(request, env, identity);
  if (assetResponse) return assetResponse;
  const response = (body: unknown, status = 200) =>
    json(body, status, { "Cache-Control": "private, no-store" });
  if (path === "/api/media/models") {
    if (request.method !== "GET") throw new ApiError(405, "method_not_allowed");
    const policy = requireMediaEnabled(env);
    return response({
      models: MEDIA_CATALOG.filter((model) =>
        policy.allowedModels.includes(model.id),
      ).map(({ id, kind, version, output }) => ({
        id,
        kind,
        version,
        output,
        hasAdapter: IMAGE_MODEL_IDS.includes(id),
        isExecutable: imageAdapterReady(env, id),
        unavailableReason: imageAdapterReady(env, id)
          ? null
          : IMAGE_MODEL_IDS.includes(id)
            ? "media_upstream_unverified"
            : "media_adapter_not_ready",
      })),
    });
  }
  if (path === "/api/media/jobs") {
    if (request.method === "GET")
      return response(await listMediaJobs(env, identity));
    if (request.method !== "POST")
      throw new ApiError(405, "method_not_allowed");
    requireMediaEnabled(env);
    if (
      request.headers.has("Content-Encoding") &&
      request.headers.get("Content-Encoding") !== "identity"
    )
      throw new ApiError(415, "unsupported_media_type");
    return response(
      await submitMedia(
        {
          env,
          identity,
          driver:
            driver ??
            (env.MEDIA_BUCKET && env.MEDIA_VERIFIED_IMAGE_MODELS
              ? createImageDriver(env)
              : undefined),
        },
        await readJson(
          request,
          mediaRequestSchema,
          MEDIA_LIMITS.jsonBytes,
          true,
        ),
      ),
      202,
    );
  }
  const match =
    /^\/api\/media\/jobs\/([a-f0-9-]{36})(?:\/(cancel|refresh|retry-collection))?$/.exec(
      path,
    );
  if (!match) return null;
  if (!z.uuid().safeParse(match[1]).success)
    throw new ApiError(400, "invalid_input");
  if (!match[2]) {
    if (request.method === "GET")
      return response(await getMediaJob(env, identity, match[1]));
    if (request.method === "DELETE")
      return response(await eraseMediaBody(env, identity, match[1]));
    throw new ApiError(405, "method_not_allowed");
  }
  if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
  if (match[2] === "cancel")
    return response(await requestMediaCancellation(env, identity, match[1]));
  const context = {
    env,
    identity,
    driver:
      driver ??
      (env.MEDIA_BUCKET && env.MEDIA_VERIFIED_IMAGE_MODELS
        ? createImageDriver(env)
        : undefined),
  };
  return response(
    match[2] === "retry-collection"
      ? await resumeMediaCollection(context, match[1])
      : await advanceMediaJob(context, match[1]),
  );
}
