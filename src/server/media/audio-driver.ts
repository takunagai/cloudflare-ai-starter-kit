import {
  AUDIO_ENDPOINTS,
  audioProviderInput,
} from "../../lib/media-audio-options";
import { inspectAudio, validateAudioRequest } from "./audio-inspection";
import { MEDIA_LIMITS } from "./catalog";
import type { MediaEnv } from "./policy";
import type { MediaDriver } from "./service";
import { createStreamOutputDriver } from "./stream-output-driver";

export function audioAdapterReady(env: MediaEnv, id: string) {
  try {
    const models: unknown = JSON.parse(env.MEDIA_VERIFIED_AUDIO_MODELS ?? "[]");
    return Boolean(
      env.FAL_KEY &&
        env.MEDIA_BUCKET &&
        env.MEDIA_BUCKET !== env.RAG_BUCKET &&
        Array.isArray(models) &&
        models.every((model) =>
          AUDIO_ENDPOINTS.some((endpoint) => endpoint === model),
        ) &&
        new Set(models).size === models.length &&
        models.includes(id),
    );
  } catch {
    return false;
  }
}
export function createAudioDriver(
  env: MediaEnv,
  transport: typeof fetch = fetch,
): MediaDriver {
  return createStreamOutputDriver(
    env,
    {
      endpoints: AUDIO_ENDPOINTS,
      field: "audio",
      maximumBytes: MEDIA_LIMITS.audioBytes,
      isReady: audioAdapterReady,
      providerInput: (media) => audioProviderInput(media.model.id, media.input),
      mime: (input) => (input.format ? "audio/mpeg" : "audio/wav"),
      invalidCode: "media_audio_invalid",
      writeUnknownCode: "media_audio_write_unknown",
      async inspect(read, length, input) {
        const audio = await inspectAudio(
          read,
          length,
          input.format ? "mp3" : "wav",
        );
        validateAudioRequest(audio, input);
        return audio;
      },
    },
    transport,
  );
}
