import { AUDIO_ENDPOINTS } from "../../lib/media-audio-options";
import { VIDEO_ENDPOINTS } from "../../lib/media-video-options";
import { createAudioDriver } from "./audio-driver";
import { createImageDriver } from "./image-driver";
import type { MediaEnv } from "./policy";
import type { MediaDriver } from "./service";
import { createVideoDriver } from "./video-driver";

/** 固定モデルの媒体だけで選択する。失敗時に別endpointへ切り替えない。 */
export function createMediaDriver(env: MediaEnv): MediaDriver {
  const image = createImageDriver(env),
    video = createVideoDriver(env),
    audio = createAudioDriver(env);
  const select = (id: string) =>
    VIDEO_ENDPOINTS.some((endpoint) => endpoint === id)
      ? video
      : AUDIO_ENDPOINTS.some((endpoint) => endpoint === id)
        ? audio
        : image;
  return {
    assertReady: (id) => select(id).assertReady?.(id),
    submit: (media, context) => select(media.model.id).submit(media, context),
    status: (job, signal) => select(job.model_id).status(job, signal),
    cancel: (job, signal) => select(job.model_id).cancel(job, signal),
    collect: (job, signal) => select(job.model_id).collect(job, signal),
    discard: (job, signal) => select(job.model_id).discard(job, signal),
  };
}
