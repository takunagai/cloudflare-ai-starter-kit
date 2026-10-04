import { describe, expect, it } from "vitest";
import {
  AUDIO_ENDPOINTS,
  audioProviderInput,
  GEMINI_TOKEN_LIMIT,
  geminiAdmission,
} from "../src/lib/media-audio-options";
import {
  inspectAudio,
  validateAudioRequest,
} from "../src/server/media/audio-inspection";
import { normalizeMedia } from "../src/server/media/catalog";
import { syntheticMp3, syntheticWav } from "./media-audio-fixtures";
import { mediaInput } from "./media-fixtures";

const inspect = (bytes: Uint8Array<ArrayBuffer>, format: "wav" | "mp3") =>
  inspectAudio(
    async (offset, count) => bytes.slice(offset, offset + count),
    bytes.length,
    format,
  );
describe("M-4 bounded WAV/MP3 inspection and strict audio contracts", () => {
  it("accepts PCM16 mono24k WAV and computes duration from aligned sample bytes", async () => {
    expect(await inspect(syntheticWav(), "wav")).toMatchObject({
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      duration: 3,
    });
  });
  it.each([
    [44100, 128],
    [44100, 192],
    [48000, 128],
    [48000, 192],
  ] as const)(
    "accepts real synthetic MP3 %sHz/%skbps with frame duration",
    async (rate, bitrate) => {
      const audio = await inspect(await syntheticMp3(rate, bitrate), "mp3");
      expect(audio).toMatchObject({ sampleRate: rate, bitrate, channels: 1 });
      expect(audio.duration).toBeGreaterThanOrEqual(3);
      expect(audio.duration).toBeLessThan(3.15);
      validateAudioRequest(audio, {
        format: `mp3_${rate}_${bitrate}`,
        duration: 3,
      });
      expect(() =>
        validateAudioRequest(audio, {
          format: `mp3_${rate === 44100 ? 48000 : 44100}_${bitrate}`,
        }),
      ).toThrow("media_audio_invalid");
      expect(() =>
        validateAudioRequest(audio, {
          format: `mp3_${rate}_${bitrate}`,
          duration: 4,
        }),
      ).toThrow("media_audio_invalid");
    },
  );
  it.each([0, 4, 8, 20, 22, 24, 28, 32, 34, 36, 40])(
    "rejects forged WAV header at %s",
    async (offset) => {
      const bytes = syntheticWav();
      bytes[offset] ^= 0xff;
      await expect(inspect(bytes, "wav")).rejects.toThrow(
        "media_audio_invalid",
      );
    },
  );
  it.each([
    "signature",
    "rate",
    "bitrate",
    "truncated",
    "junk",
    "reservoir",
    "mixed-rate",
    "id3-size",
  ])("rejects malformed MP3 %s", async (kind) => {
    let bytes = await syntheticMp3();
    if (kind === "signature") bytes[0] = 0;
    if (kind === "rate") bytes[2] |= 12;
    if (kind === "bitrate") bytes[2] |= 0xf0;
    if (kind === "truncated") bytes = bytes.slice(0, -1);
    if (kind === "junk") bytes = new Uint8Array([...bytes, 1]);
    if (kind === "reservoir") bytes[4] = 255;
    if (kind === "mixed-rate") bytes[384 + 2] &= 0xf3;
    if (kind === "id3-size")
      bytes.set([73, 68, 51, 4, 0, 0, 127, 127, 127, 127]);
    await expect(inspect(bytes, "mp3")).rejects.toThrow("media_audio_invalid");
  });
  it("rejects format spoof and oversized/short range reads without allocating full output", async () => {
    await expect(inspect(syntheticWav(), "mp3")).rejects.toThrow();
    await expect(inspect(await syntheticMp3(), "wav")).rejects.toThrow();
    await expect(
      inspectAudio(async () => new Uint8Array(), 32 * 1024 * 1024 + 1, "wav"),
    ).rejects.toThrow();
    await expect(
      inspectAudio(async () => new Uint8Array(1), 100, "wav"),
    ).rejects.toThrow();
  });
  it.each([8, 9])(
    "maps single and ordered dialogue endpoint%s without mixed fields",
    (index) => {
      const media = normalizeMedia(
        mediaInput(index, {
          mode: "dialogue",
          instruction: "穏やかに",
          speakers: [
            { alias: "B", voice: "Puck" },
            { alias: "A", voice: "Kore" },
          ],
          turns: [
            { alias: "A", text: "一", instruction: "静かに" },
            { alias: "B", text: "二" },
          ],
        }),
      );
      expect(audioProviderInput(media.model.id, media.input)).toEqual({
        style_instructions: "穏やかに",
        speakers: [
          { speaker_id: "B", voice: "Puck" },
          { speaker_id: "A", voice: "Kore" },
        ],
        turns: [
          { speaker_id: "A", text: "一", style_instructions: "静かに" },
          { speaker_id: "B", text: "二" },
        ],
      });
      const single = normalizeMedia(mediaInput(index));
      expect(audioProviderInput(single.model.id, single.input)).toEqual({
        prompt: "TEST_ONLY_speech",
        voice: "Kore",
      });
    },
  );
  it("separates byte quota from conservative token admission, includes aliases/voices/styles/turns and Unicode expansion", () => {
    const short = normalizeMedia(
      mediaInput(8, { mode: "single", text: "a".repeat(100) }),
    );
    const score = geminiAdmission(short.input);
    expect(score.canAccept).toBe(true);
    expect(score.score).not.toBe(short.inputBytes);
    for (const text of [
      "a".repeat(2000),
      "あ".repeat(700),
      "㍿".repeat(200),
      "\ud800",
      "\u0000",
    ])
      expect(() =>
        normalizeMedia(mediaInput(8, { mode: "single", text })),
      ).toThrow("media_gemini_admission_limit");
    const dialogue = {
      mode: "dialogue",
      speakers: [
        { alias: "A", voice: "Kore" },
        { alias: "B", voice: "Puck" },
      ],
      turns: Array.from({ length: 32 }, () => ({ alias: "A", text: "xxxxxx" })),
    };
    expect(geminiAdmission(dialogue).score).toBeGreaterThan(GEMINI_TOKEN_LIMIT);
    expect(() => normalizeMedia(mediaInput(9, dialogue))).toThrow(
      "media_gemini_admission_limit",
    );
  });
  it.each([
    [8, { mode: "single", text: "x", turns: [] }],
    [
      8,
      {
        mode: "dialogue",
        speakers: [
          { alias: "A", voice: "Kore" },
          { alias: "B", voice: "Puck" },
          { alias: "C", voice: "Kore" },
        ],
        turns: [{ alias: "A", text: "x" }],
      },
    ],
    [
      8,
      {
        mode: "dialogue",
        speakers: [
          { alias: "A", voice: "Kore" },
          { alias: "B", voice: "Puck" },
        ],
        turns: [{ alias: "C", text: "x" }],
      },
    ],
    [10, { text: "x", voice: "cloned" }],
    [10, { text: "x", voice: "Rachel", language: "jpn" }],
    [10, { text: "x", voice: "Rachel", timestamps: true }],
    [10, { text: "x", voice: "Rachel", streaming: true }],
    [10, { text: "x", voice: "Rachel", format: "pcm_24000" }],
    [10, { text: "x", voice: "Rachel", stability: 1.01 }],
    [10, { text: "x", voice: "Rachel", similarityBoost: -0.01 }],
    [11, { prompt: "x" }],
    [11, { prompt: "x", duration: 2 }],
    [11, { prompt: "x", duration: 61 }],
    [11, { prompt: "x", duration: 3.5 }],
    [11, { prompt: "x", duration: 3, composition_plan: {} }],
    [11, { prompt: "x", duration: 3, seed: 1 }],
  ] as const)("rejects excluded audio input%s %j", (index, input) => {
    expect(() => normalizeMedia(mediaInput(index, { ...input }))).toThrow(
      "invalid_input",
    );
  });
  it.each([3, 60])(
    "explicit music %ss maps milliseconds and instrumental without seed/plan",
    (duration) => {
      const media = normalizeMedia(
        mediaInput(11, { prompt: "音楽", duration, instrumental: true }),
      );
      expect(audioProviderInput(AUDIO_ENDPOINTS[3], media.input)).toEqual({
        prompt: "音楽",
        music_length_ms: duration * 1000,
        force_instrumental: true,
        output_format: "mp3_48000_128",
      });
    },
  );
  it("maps Eleven voice/language/settings/seed/normalization and MP3 only", () => {
    const media = normalizeMedia(
      mediaInput(10, {
        text: "こんにちは",
        voice: "Aria",
        language: "ja",
        stability: 0,
        similarityBoost: 1,
        seed: 0,
        normalization: "off",
        format: "mp3_44100_192",
      }),
    );
    expect(audioProviderInput(media.model.id, media.input)).toEqual({
      text: "こんにちは",
      voice: "Aria",
      language_code: "ja",
      stability: 0,
      similarity_boost: 1,
      seed: 0,
      apply_text_normalization: "off",
      output_format: "mp3_44100_192",
      timestamps: false,
    });
  });
});
