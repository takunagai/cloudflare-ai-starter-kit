export const AUDIO_ENDPOINTS = [
  "google/gemini-3.8-flash-tts",
  "google/gemini-3.8-flash-lite-tts",
  "elevenlabs/tts/eleven-v4",
  "elevenlabs/music/v2.5",
] as const;
export const GEMINI_VOICES = [
  "Achernar",
  "Achird",
  "Algenib",
  "Algieba",
  "Alnilam",
  "Aoede",
  "Autonoe",
  "Callirrhoe",
  "Charon",
  "Despina",
  "Enceladus",
  "Erinome",
  "Fenrir",
  "Gacrux",
  "Iapetus",
  "Kore",
  "Laomedeia",
  "Leda",
  "Orus",
  "Pulcherrima",
  "Puck",
  "Rasalgethi",
  "Sadachbia",
  "Sadaltager",
  "Schedar",
  "Sulafat",
  "Umbriel",
  "Vindemiatrix",
  "Zephyr",
  "Zubenelgenubi",
] as const;
export const ELEVEN_VOICES = ["Rachel", "Aria"] as const;
export const SPEECH_FORMATS = ["mp3_44100_128", "mp3_44100_192"] as const;
export const MUSIC_FORMATS = ["mp3_48000_128", "mp3_48000_192"] as const;
// ISO 639-1の固定部分集合。未確認の言語へ自動変更しない。
export const SPEECH_LANGUAGES = [
  "ja",
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "ko",
  "zh",
  "hi",
  "ar",
] as const;
export const TEXT_NORMALIZATION = ["auto", "on", "off"] as const;
export const GEMINI_TOKEN_LIMIT = 8192;

export function speechParts(input: Record<string, unknown>): string[] {
  const speakers = input.speakers as
    | { alias: string; voice: string }[]
    | undefined;
  const turns = input.turns as
    | { alias: string; text: string; instruction?: string }[]
    | undefined;
  return [
    ...(typeof input.text === "string" ? [input.text] : []),
    String(input.instruction ?? ""),
    ...(speakers?.map((speaker) => speaker.alias) ?? []),
    ...(turns?.flatMap((turn) => [
      turn.alias,
      turn.text,
      turn.instruction ?? "",
    ]) ?? []),
  ];
}

/** token計数ではなく保守的な受付スコア。本文を増補・正規化して送信しない。 */
export function geminiAdmission(input: Record<string, unknown>) {
  const parts = [
    ...speechParts(input),
    ...((input.speakers as { voice: string }[] | undefined)?.map(
      (speaker) => speaker.voice,
    ) ?? []),
    String(input.voice ?? ""),
  ];
  const encoder = new TextEncoder();
  // byte fallbackとUnicode正規化による展開を考慮し、各表現の大きい方に4倍の余裕。
  // 1024はwrapper用、フィールドごとの64は区切り/role用の余裕。実token数とは呼ばない。
  const score =
    1024 +
    parts.length * 64 +
    parts.reduce(
      (sum, part) =>
        sum +
        4 *
          Math.max(
            encoder.encode(part).length,
            encoder.encode(part.normalize("NFKC")).length,
          ),
      0,
    );
  const hasInvalidUnicode = parts.some(
    (part) =>
      /[\uD800-\uDFFF]/u.test(part) ||
      [...part].some((character) => {
        const point = character.codePointAt(0) ?? 0;
        return (point < 32 && ![9, 10, 13].includes(point)) || point === 127;
      }),
  );
  return {
    score,
    canAccept: !hasInvalidUnicode && score <= GEMINI_TOKEN_LIMIT,
  };
}

export function audioProviderInput(
  model: string,
  input: Record<string, unknown>,
) {
  if (model === AUDIO_ENDPOINTS[0] || model === AUDIO_ENDPOINTS[1]) {
    const style =
      input.instruction === undefined
        ? {}
        : { style_instructions: input.instruction };
    if (input.mode === "single")
      return { prompt: input.text, voice: input.voice, ...style };
    return {
      ...style,
      speakers: (input.speakers as { alias: string; voice: string }[]).map(
        ({ alias, voice }) => ({ speaker_id: alias, voice }),
      ),
      turns: (
        input.turns as { alias: string; text: string; instruction?: string }[]
      ).map(({ alias, text, instruction }) => ({
        speaker_id: alias,
        text,
        ...(instruction === undefined
          ? {}
          : { style_instructions: instruction }),
      })),
    };
  }
  if (model === AUDIO_ENDPOINTS[2])
    return {
      text: input.text,
      voice: input.voice,
      stability: input.stability,
      similarity_boost: input.similarityBoost,
      output_format: input.format,
      apply_text_normalization: input.normalization,
      timestamps: false,
      ...(input.language === undefined
        ? {}
        : { language_code: input.language }),
      ...(input.seed === undefined ? {} : { seed: input.seed }),
    };
  if (model === AUDIO_ENDPOINTS[3])
    return {
      prompt: input.prompt,
      music_length_ms: Number(input.duration) * 1000,
      force_instrumental: input.instrumental,
      output_format: input.format,
    };
  throw new Error("media_model_unknown");
}
