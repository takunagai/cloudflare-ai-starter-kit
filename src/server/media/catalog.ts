import { z } from "zod";
import {
  AUDIO_ENDPOINTS,
  ELEVEN_VOICES,
  GEMINI_VOICES,
  geminiAdmission,
  MUSIC_FORMATS,
  SPEECH_FORMATS,
  SPEECH_LANGUAGES,
  speechParts,
  TEXT_NORMALIZATION,
} from "../../lib/media-audio-options";

export { GEMINI_VOICES } from "../../lib/media-audio-options";

import {
  IMAGE_ENDPOINTS,
  IMAGE_PRESETS,
  IMAGE_QUALITIES,
} from "../../lib/media-image-options";
import {
  isCameraValid,
  VIDEO_ENDPOINTS,
  VIDEO_RATIOS,
} from "../../lib/media-video-options";
import { ApiError } from "../http";

export const MEDIA_CATALOG_VERSION = "media-v1";
export const MEDIA_LIMITS = {
  jsonBytes: 16_384,
  ownerStorageBytes: 1_073_741_824,
  environmentStorageBytes: 10_737_418_240,
  imageBytes: 20 * 1024 * 1024,
  videoBytes: 256 * 1024 * 1024,
  audioBytes: 32 * 1024 * 1024,
  referenceBytes: 50 * 1024 * 1024,
  referenceLifetimeMs: 7 * 86_400_000,
  outputLifetimeMs: 30 * 86_400_000,
  bodyRetentionMs: 30 * 86_400_000,
  ledgerRetentionMs: 90 * 86_400_000,
  leaseMs: 30_000,
  monitorMs: 60 * 60_000,
} as const;
export const MEDIA_MODEL_IDS = [
  ...IMAGE_ENDPOINTS,
  ...VIDEO_ENDPOINTS,
  ...AUDIO_ENDPOINTS,
] as const;
export type MediaModelId = (typeof MEDIA_MODEL_IDS)[number];
export type MediaKind = "image" | "video" | "tts" | "music";
const codePoints = (max: number) =>
  z
    .string()
    .min(1)
    .refine((value) => [...value].length <= max);
const instruction = codePoints(500).optional();
const assetId = z.uuid();
const dimensions = z
  .strictObject({
    width: z.number().int().min(16).max(3840),
    height: z.number().int().min(16).max(3840),
  })
  .refine(
    ({ width, height }) =>
      width % 16 === 0 &&
      height % 16 === 0 &&
      Math.max(width, height) / Math.min(width, height) <= 3 &&
      width * height >= 655360 &&
      width * height <= 8294400,
  );
const IMAGE_SIZES = IMAGE_PRESETS;
const imageSize = z.union([
  z
    .enum(["square", "landscape", "portrait", "widescreen", "vertical"])
    .transform((value) => IMAGE_SIZES[value]),
  dimensions,
]);
const imageFields = {
  prompt: codePoints(4000),
  size: imageSize.default(IMAGE_SIZES.square),
  quality: z.enum(IMAGE_QUALITIES).default("medium"),
  count: z.number().int().min(1).max(4).default(1),
  format: z.enum(["png", "jpeg", "webp"]).default("png"),
  background: z.enum(["auto", "opaque", "transparent"]).default("auto"),
  compression: z.number().int().min(0).max(100).optional(),
};
const imageCompatible = (value: {
  format: string;
  background: string;
  compression?: number;
}) =>
  !(value.format === "jpeg" && value.background === "transparent") &&
  !(value.format === "png" && value.compression !== undefined);
const imageSchema = z.strictObject(imageFields).refine(imageCompatible);
const editSchema = z
  .strictObject({
    ...imageFields,
    size: z.union([imageSize, z.literal("auto")]).default("auto"),
    references: z.array(assetId).min(1).max(8),
    mask: assetId.optional(),
  })
  .refine(imageCompatible);
const videoFields = {
  prompt: codePoints(4000),
  duration: z.union([z.literal(5), z.literal(10)]).default(5),
  resolution: z.enum(["480P", "768P", "1080P"]).default("768P"),
  seed: z.number().int().min(0).max(2147483647).optional(),
};
const aspectRatio = z.enum(VIDEO_RATIOS);
const textVideoSchema = z.strictObject({
  ...videoFields,
  aspectRatio: aspectRatio.default("16:9"),
});
const imageVideoSchema = z
  .strictObject({
    ...videoFields,
    start: assetId.optional(),
    end: assetId.optional(),
  })
  .refine((value) => Boolean(value.start || value.end));
const referenceVideoSchema = z.strictObject({
  ...videoFields,
  references: z
    .array(assetId)
    .min(1)
    .max(4)
    .refine((values) => new Set(values).size === values.length),
  start: assetId.optional(),
  end: assetId.optional(),
  aspectRatio: z
    .union([aspectRatio, z.literal("adaptive")])
    .default("adaptive"),
});
const cameraSchema = z
  .strictObject({
    ...videoFields,
    resolution: videoFields.resolution.default("480P"),
    start: assetId,
    keyframes: z
      .array(
        z.strictObject({
          time: z.number().min(0).max(1),
          azimuth: z.number().finite(),
          elevation: z.number().min(-90).max(90),
          distance: z.number().min(0.1).max(10),
        }),
      )
      .min(2)
      .max(12),
  })
  .refine(({ keyframes }) => isCameraValid(keyframes));
const singleSpeech = z.strictObject({
  mode: z.literal("single"),
  text: codePoints(4000),
  voice: z.enum(GEMINI_VOICES).default("Kore"),
  instruction,
});
const dialogue = z
  .strictObject({
    mode: z.literal("dialogue"),
    instruction,
    speakers: z
      .array(
        z.strictObject({
          alias: codePoints(100),
          voice: z.enum(GEMINI_VOICES),
        }),
      )
      .length(2),
    turns: z
      .array(
        z.strictObject({
          alias: codePoints(100),
          text: codePoints(4000),
          instruction,
        }),
      )
      .min(1)
      .max(32),
  })
  .refine(
    ({ speakers, turns }) =>
      speakers[0].alias !== speakers[1].alias &&
      turns.every((turn) =>
        speakers.some((speaker) => speaker.alias === turn.alias),
      ),
  );
const geminiSchema = z.union([singleSpeech, dialogue]);
const elevenSchema = z.strictObject({
  text: codePoints(4000),
  voice: z.enum(ELEVEN_VOICES),
  language: z.enum(SPEECH_LANGUAGES).optional(),
  normalization: z.enum(TEXT_NORMALIZATION).default("auto"),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  seed: videoFields.seed,
  format: z.enum(SPEECH_FORMATS).default("mp3_44100_128"),
});
const musicSchema = z.strictObject({
  prompt: codePoints(2000),
  duration: z.number().int().min(3).max(60),
  instrumental: z.boolean().default(false),
  format: z.enum(MUSIC_FORMATS).default("mp3_48000_128"),
});
export const mediaRequestSchema = z.strictObject({
  requestId: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  model: z.enum(MEDIA_MODEL_IDS),
  input: z.unknown(),
});
export type MediaRequest = z.infer<typeof mediaRequestSchema>;
const SCHEMAS = [
  imageSchema,
  editSchema,
  imageSchema,
  editSchema,
  textVideoSchema,
  imageVideoSchema,
  referenceVideoSchema,
  cameraSchema,
  geminiSchema,
  geminiSchema,
  elevenSchema,
  musicSchema,
] as const;
export const MEDIA_CATALOG = MEDIA_MODEL_IDS.map((id, index) => ({
  id,
  version: MEDIA_CATALOG_VERSION,
  kind: (index < 4
    ? "image"
    : index < 8
      ? "video"
      : index < 11
        ? "tts"
        : "music") as MediaKind,
  queuePath: id,
  schema: SCHEMAS[index],
  output: {
    field: index < 4 ? "images" : index < 8 ? "video" : "audio",
    formats:
      index < 4
        ? ["png", "jpeg", "webp"]
        : index < 8
          ? ["mp4"]
          : index < 10
            ? ["wav"]
            : ["mp3"],
  },
}));
export function mediaModel(id: string) {
  const model = MEDIA_CATALOG.find((model) => model.id === id);
  if (!model) throw new ApiError(400, "media_model_unknown");
  return model;
}
export type NormalizedMedia = ReturnType<typeof normalizeMedia>;
export function normalizeMedia(raw: unknown) {
  if (
    new TextEncoder().encode(JSON.stringify(raw)).byteLength >
    MEDIA_LIMITS.jsonBytes
  )
    throw new ApiError(413, "payload_too_large");
  const request = mediaRequestSchema.safeParse(raw);
  if (!request.success) throw new ApiError(400, "invalid_input");
  const model = mediaModel(request.data.model);
  const parsed = model.schema.safeParse(request.data.input);
  if (!parsed.success) throw new ApiError(400, "invalid_input");
  const input = parsed.data as Record<string, unknown>;
  const inputBytes =
    model.kind === "tts"
      ? new TextEncoder().encode(speechParts(input).join("")).byteLength
      : 0;
  if (inputBytes > 4000) throw new ApiError(400, "media_input_bytes_limit");
  if (model.id.startsWith("google/") && !geminiAdmission(input).canAccept)
    throw new ApiError(400, "media_gemini_admission_limit");
  const quantity =
    model.kind === "image"
      ? Number(input.count)
      : model.kind === "tts"
        ? inputBytes
        : Number(input.duration);
  const reservedBytes =
    model.kind === "image"
      ? quantity * MEDIA_LIMITS.imageBytes
      : model.kind === "video"
        ? MEDIA_LIMITS.videoBytes
        : MEDIA_LIMITS.audioBytes;
  const references: {
    id: string;
    role: "reference" | "start" | "end" | "mask";
    ordinal: number;
  }[] = [];
  for (const [ordinal, id] of (
    (input.references as string[] | undefined) ?? []
  ).entries())
    references.push({ id, role: "reference", ordinal });
  for (const role of ["start", "end", "mask"] as const)
    if (typeof input[role] === "string")
      references.push({ id: input[role], role, ordinal: 0 });
  return {
    request: request.data,
    model,
    input,
    inputBytes,
    quantity,
    reservedBytes,
    references,
  };
}
