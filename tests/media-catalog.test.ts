import { describe, expect, it } from "vitest";
import {
  GEMINI_VOICES,
  MEDIA_CATALOG,
  MEDIA_MODEL_IDS,
  normalizeMedia,
} from "../src/server/media/catalog";

const REQUEST_ID = "2026-10-04:11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const MASK_ID = "33333333-3333-4333-8333-333333333333";
const fixture = (index: number) => ({
  requestId: REQUEST_ID,
  model: MEDIA_MODEL_IDS[index],
  input:
    index < 4
      ? { prompt: "合成画像", ...(index % 2 ? { references: [ASSET_ID] } : {}) }
      : index < 8
        ? {
            prompt: "合成動画",
            ...(index === 5 || index === 7 ? { start: ASSET_ID } : {}),
            ...(index === 6 ? { references: [ASSET_ID] } : {}),
            ...(index === 7
              ? {
                  keyframes: [
                    { time: 0, azimuth: 0, elevation: 0, distance: 1 },
                    { time: 1, azimuth: 90, elevation: 0, distance: 0.7 },
                  ],
                }
              : {}),
          }
        : index < 10
          ? { mode: "single", text: "合成音声" }
          : index === 10
            ? { text: "合成音声", voice: "Rachel" }
            : { prompt: "合成音楽", duration: 30 },
});
describe("M-1 fixed catalog and strict application inputs", () => {
  it.each(MEDIA_MODEL_IDS)(
    "normalizes %s with bounded output reservation",
    (model) => {
      const index = MEDIA_MODEL_IDS.indexOf(model);
      const normalized = normalizeMedia(fixture(index));
      expect(normalized.model.id).toBe(model);
      expect(normalized.reservedBytes).toBeGreaterThan(0);
      expect(normalized.quantity).toBeGreaterThan(0);
      expect(MEDIA_CATALOG[index].queuePath).toBe(model);
    },
  );
  it("has exactly 4 image, 4 video, 3 TTS, 1 music and 30 fixed voices", () => {
    expect(new Set(MEDIA_MODEL_IDS).size).toBe(12);
    expect(MEDIA_CATALOG.map((model) => model.kind)).toEqual([
      ...Array(4).fill("image"),
      ...Array(4).fill("video"),
      ...Array(3).fill("tts"),
      "music",
    ]);
    expect(new Set(GEMINI_VOICES).size).toBe(30);
  });
  it("rejects unknown endpoints, top-level keys and arbitrary provider payload", () => {
    for (const value of [
      { ...fixture(0), model: "fal-ai/flux/schnell" },
      { ...fixture(0), userId: "TEST_ONLY_other" },
      { ...fixture(0), input: { prompt: "x", sync_mode: true } },
      {
        ...fixture(1),
        input: { prompt: "x", image_urls: ["https://example.invalid/x.png"] },
      },
    ])
      expect(() => normalizeMedia(value)).toThrow();
  });
  it("counts Unicode code points, normalizes named sizes and enforces image constraints", () => {
    expect(
      normalizeMedia({
        ...fixture(0),
        input: { prompt: "😀".repeat(4000), size: "widescreen" },
      }).input.size,
    ).toEqual({ width: 1536, height: 864 });
    for (const input of [
      { prompt: "a".repeat(4001) },
      { prompt: "x", size: { width: 1025, height: 1024 } },
      { prompt: "x", size: { width: 3840, height: 3840 } },
      { prompt: "x", count: 5 },
      { prompt: "x", format: "jpeg", background: "transparent" },
      { prompt: "x", compression: 50 },
      { prompt: "x", size: "auto" },
    ])
      expect(() => normalizeMedia({ ...fixture(0), input })).toThrow();
    expect(
      normalizeMedia({
        ...fixture(1),
        input: { prompt: "x", references: [ASSET_ID, MASK_ID], mask: MASK_ID },
      }).references.map((value) => value.id),
    ).toEqual([ASSET_ID, MASK_ID, MASK_ID]);
  });
  it("enforces video roles, duration, camera endpoints and excludes video/audio URLs", () => {
    for (const [index, input] of [
      [4, { prompt: "x", duration: 15 }],
      [5, { prompt: "x" }],
      [5, { prompt: "x", start: ASSET_ID, aspectRatio: "16:9" }],
      [6, { prompt: "x", references: Array(5).fill(ASSET_ID) }],
      [4, { prompt: "x", target_audio_url: "https://example.invalid/x.mp3" }],
      [
        7,
        {
          prompt: "x",
          start: ASSET_ID,
          keyframes: [
            { time: 0, azimuth: 0, elevation: 0, distance: 1 },
            { time: 1, azimuth: 721, elevation: 0, distance: 1 },
          ],
        },
      ],
      [
        7,
        {
          prompt: "x",
          start: ASSET_ID,
          keyframes: [
            { time: 0.5, azimuth: 0, elevation: 0, distance: 1 },
            { time: 1, azimuth: 0, elevation: 0, distance: 1 },
          ],
        },
      ],
    ] as const)
      expect(() => normalizeMedia({ ...fixture(index), input })).toThrow();
  });
  it("uses UTF-8 bytes for speech, validates two aliases and refuses excluded music composition", () => {
    expect(
      normalizeMedia({
        ...fixture(10),
        input: { voice: "Rachel", text: "あ".repeat(1333) },
      }).quantity,
    ).toBe(3999);
    expect(() =>
      normalizeMedia({
        ...fixture(10),
        input: { voice: "Rachel", text: "あ".repeat(1334) },
      }),
    ).toThrow();
    const input = {
      mode: "dialogue",
      speakers: [
        { alias: "A", voice: "Kore" },
        { alias: "B", voice: "Puck" },
      ],
      turns: [{ alias: "A", text: "x" }],
    };
    expect(normalizeMedia({ ...fixture(9), input }).quantity).toBe(4);
    for (const value of [
      { ...input, turns: [{ alias: "C", text: "x" }] },
      { ...input, text: "mixed" },
      { ...input, speakers: [input.speakers[0], input.speakers[0]] },
      { mode: "single", text: "x", voice: "unknown" },
    ])
      expect(() => normalizeMedia({ ...fixture(9), input: value })).toThrow();
    for (const value of [
      { prompt: "x", duration: 2 },
      { prompt: "x", duration: 61 },
      { prompt: "x", seed: 1 },
      { composition_plan: {} },
    ])
      expect(() => normalizeMedia({ ...fixture(11), input: value })).toThrow();
    expect(() =>
      normalizeMedia({ ...fixture(0), input: { prompt: "x".repeat(16385) } }),
    ).toThrow();
  });
});
