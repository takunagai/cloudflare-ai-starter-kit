import { VIDEO_ENDPOINTS } from "../../lib/media-video-options";
import { ApiError } from "../http";
import { MEDIA_LIMITS, type NormalizedMedia } from "./catalog";
import type { MediaEnv } from "./policy";
import type { MediaDriver } from "./service";
import { createStreamOutputDriver } from "./stream-output-driver";
import { inspectVideo, validateVideoRequest } from "./video-inspection";

export function videoAdapterReady(env: MediaEnv, id: string) {
  try {
    const models: unknown = JSON.parse(env.MEDIA_VERIFIED_VIDEO_MODELS ?? "[]");
    return Boolean(
      env.FAL_KEY &&
        env.MEDIA_BUCKET &&
        env.MEDIA_BUCKET !== env.RAG_BUCKET &&
        Array.isArray(models) &&
        models.every((model) =>
          VIDEO_ENDPOINTS.some((endpoint) => endpoint === model),
        ) &&
        new Set(models).size === models.length &&
        models.includes(id),
    );
  } catch {
    return false;
  }
}
export function videoProviderInput(
  media: NormalizedMedia,
  grants: { role: string; ordinal: number; url: string }[],
) {
  if (!VIDEO_ENDPOINTS.some((id) => id === media.model.id))
    throw new ApiError(400, "media_model_unknown");
  const input = media.input,
    referenceUrls = grants
      .filter((grant) => grant.role === "reference")
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((grant) => grant.url);
  const start = grants.find((grant) => grant.role === "start")?.url,
    end = grants.find((grant) => grant.role === "end")?.url;
  const mode = media.model.id.split("/").at(-1);
  if (
    (input.start && !start) ||
    (input.end && !end) ||
    (mode === "image-to-video" && !start && !end) ||
    (mode === "camera-controls" && !start) ||
    (mode === "reference-to-video" &&
      (!referenceUrls.length ||
        referenceUrls.length !== (input.references as string[]).length))
  )
    throw new ApiError(400, "media_reference_invalid");
  return {
    prompt: input.prompt,
    duration: input.duration,
    resolution: input.resolution,
    enable_safety_checker: true,
    prompt_expansion_mode: "disabled",
    sync_mode: false,
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    ...(mode === "text-to-video" || mode === "reference-to-video"
      ? { aspect_ratio: input.aspectRatio }
      : {}),
    ...(mode === "reference-to-video"
      ? { reference_image_urls: referenceUrls }
      : {}),
    ...(start ? { image_url: start } : {}),
    ...(end ? { end_image_url: end } : {}),
    ...(mode === "camera-controls"
      ? { camera_trajectory: input.keyframes }
      : {}),
  };
}

/** transportは内部合成試験用。 */
export function createVideoDriver(
  env: MediaEnv,
  transport: typeof fetch = fetch,
): MediaDriver {
  return createStreamOutputDriver(
    env,
    {
      endpoints: VIDEO_ENDPOINTS,
      field: "video",
      maximumBytes: MEDIA_LIMITS.videoBytes,
      isReady: videoAdapterReady,
      providerInput: videoProviderInput,
      mime: () => "video/mp4",
      invalidCode: "media_video_invalid",
      writeUnknownCode: "media_video_write_unknown",
      async inspect(read, length, input, canvas) {
        const video = await inspectVideo(read, length);
        validateVideoRequest(video, input, canvas);
        return video;
      },
    },
    transport,
  );
}
