import { useRef, useState } from "react";
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
} from "../lib/media-audio-options";

const LABELS = [
  "Gemini Flash TTS",
  "Gemini Flash Lite TTS",
  "Eleven v4 TTS",
  "Eleven Music v2.5",
];
type Turn = { id: string; alias: string; text: string; instruction: string };
export function AudioControls({
  models,
  isBusy,
  isEnabled,
  submit,
}: {
  models: { id: string; isExecutable: boolean }[];
  isBusy: boolean;
  isEnabled: boolean;
  submit: (request: {
    model: string;
    requestId: string;
    input: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const [model, setModel] = useState<string>(AUDIO_ENDPOINTS[0]),
    [mode, setMode] = useState("single");
  const [text, setText] = useState(""),
    [instruction, setInstruction] = useState(""),
    [voice, setVoice] = useState("Kore");
  const [speakers, setSpeakers] = useState([
    { alias: "話者A", voice: "Kore" },
    { alias: "話者B", voice: "Puck" },
  ]);
  const [turns, setTurns] = useState<Turn[]>([
    { id: "initial", alias: "話者A", text: "", instruction: "" },
  ]);
  const [elevenVoice, setElevenVoice] = useState("Rachel"),
    [language, setLanguage] = useState("");
  const [stability, setStability] = useState(0.5),
    [similarityBoost, setSimilarityBoost] = useState(0.75),
    [seed, setSeed] = useState("");
  const [normalization, setNormalization] = useState("auto"),
    [speechFormat, setSpeechFormat] = useState<string>(SPEECH_FORMATS[0]);
  const [duration, setDuration] = useState(30),
    [instrumental, setInstrumental] = useState(false),
    [musicFormat, setMusicFormat] = useState<string>(MUSIC_FORMATS[0]);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const isGemini = model.startsWith("google/"),
    isMusic = model === AUDIO_ENDPOINTS[3];
  const input: Record<string, unknown> = isMusic
    ? { prompt: text, duration, instrumental, format: musicFormat }
    : isGemini
      ? {
          mode,
          ...(instruction ? { instruction } : {}),
          ...(mode === "single"
            ? { text, voice }
            : {
                speakers,
                turns: turns.map(({ id: _id, instruction, ...turn }) => ({
                  ...turn,
                  ...(instruction ? { instruction } : {}),
                })),
              }),
        }
      : {
          text,
          voice: elevenVoice,
          stability,
          similarityBoost,
          format: speechFormat,
          normalization,
          ...(language ? { language } : {}),
          ...(seed === "" ? {} : { seed: Number(seed) }),
        };
  const inputBytes = new TextEncoder().encode(
    speechParts(input).join(""),
  ).length;
  const hasDialogue = isGemini && mode === "dialogue";
  const isContentValid = hasDialogue
    ? speakers.every((speaker) => !!speaker.alias.trim()) &&
      speakers[0].alias !== speakers[1].alias &&
      turns.every(
        (turn) =>
          !!turn.text.trim() &&
          speakers.some((speaker) => speaker.alias === turn.alias),
      )
    : !!text.trim();
  const admission = geminiAdmission(input);
  const isExecutable = models.some(
    (item) => item.id === model && item.isExecutable,
  );
  const canSubmit =
    isEnabled &&
    !isBusy &&
    isExecutable &&
    isContentValid &&
    (isMusic
      ? Number.isInteger(duration) &&
        duration >= 3 &&
        duration <= 60 &&
        [...text].length <= 2000
      : inputBytes <= 4000) &&
    (!isGemini || admission.canAccept);
  const select = (
    label: string,
    value: string,
    values: readonly string[],
    change: (value: string) => void,
  ) => (
    <label>
      {label}
      <select
        value={value}
        disabled={isBusy}
        onChange={(event) => change(event.target.value)}
      >
        {values.map((item) => (
          <option key={item} value={item}>
            {item || "自動"}
          </option>
        ))}
      </select>
    </label>
  );
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const key = JSON.stringify([model, input]);
    if (requestRef.current?.key !== key)
      requestRef.current = {
        key,
        id: `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
      };
    await submit({ model, input, requestId: requestRef.current.id });
  }
  return (
    <section className="resource-card">
      <h2>音声を作る</h2>
      <form className="app-form" onSubmit={generate}>
        <label>
          音声モデル
          <select
            value={model}
            disabled={isBusy}
            onChange={(event) => setModel(event.target.value)}
          >
            {AUDIO_ENDPOINTS.filter((id) =>
              models.some((item) => item.id === id),
            ).map((id) => (
              <option key={id} value={id}>
                {LABELS[AUDIO_ENDPOINTS.indexOf(id)]}
              </option>
            ))}
          </select>
        </label>
        {isGemini &&
          select("話者モード", mode, ["single", "dialogue"], setMode)}
        {!hasDialogue && (
          <label>
            {isMusic ? "音楽の説明" : "読み上げ本文"}
            <textarea
              required
              value={text}
              maxLength={isMusic ? 2000 : 4000}
              disabled={isBusy}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        )}
        {isGemini && (
          <>
            <label>
              全体の演技指示（任意）
              <textarea
                value={instruction}
                maxLength={500}
                disabled={isBusy}
                onChange={(event) => setInstruction(event.target.value)}
              />
            </label>
            {!hasDialogue &&
              select("Geminiの音声", voice, GEMINI_VOICES, setVoice)}
            {hasDialogue && (
              <fieldset>
                <legend>2話者の台本</legend>
                {speakers.map((speaker, index) => (
                  <div
                    className="form-grid"
                    key={index === 0 ? "first" : "second"}
                  >
                    <label>
                      話者{index + 1}のalias
                      <input
                        required
                        maxLength={100}
                        value={speaker.alias}
                        disabled={isBusy}
                        onChange={(event) => {
                          const alias = event.target.value;
                          setSpeakers((current) =>
                            current.map((item, position) =>
                              position === index ? { ...item, alias } : item,
                            ),
                          );
                          setTurns((current) =>
                            current.map((turn) =>
                              turn.alias === speaker.alias
                                ? { ...turn, alias }
                                : turn,
                            ),
                          );
                        }}
                      />
                    </label>
                    {select(
                      `話者${index + 1}の音声`,
                      speaker.voice,
                      GEMINI_VOICES,
                      (voice) =>
                        setSpeakers((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, voice } : item,
                          ),
                        ),
                    )}
                  </div>
                ))}
                {turns.map((turn, index) => (
                  <div className="resource-card" key={turn.id}>
                    <p>台詞 {index + 1}</p>
                    {select(
                      `台詞${index + 1}の話者`,
                      turn.alias,
                      speakers.map((speaker) => speaker.alias),
                      (alias) =>
                        setTurns((current) =>
                          current.map((item) =>
                            item.id === turn.id ? { ...item, alias } : item,
                          ),
                        ),
                    )}
                    <label>
                      台詞{index + 1}の本文
                      <textarea
                        required
                        value={turn.text}
                        disabled={isBusy}
                        maxLength={4000}
                        onChange={(event) =>
                          setTurns((current) =>
                            current.map((item) =>
                              item.id === turn.id
                                ? { ...item, text: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      台詞{index + 1}の演技指示
                      <textarea
                        value={turn.instruction}
                        disabled={isBusy}
                        maxLength={500}
                        onChange={(event) =>
                          setTurns((current) =>
                            current.map((item) =>
                              item.id === turn.id
                                ? { ...item, instruction: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <div className="button-row">
                      <button
                        type="button"
                        disabled={isBusy || index === 0}
                        onClick={() =>
                          setTurns((current) => {
                            const next = [...current];
                            [next[index - 1], next[index]] = [
                              next[index],
                              next[index - 1],
                            ];
                            return next;
                          })
                        }
                      >
                        台詞を前へ
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || turns.length === 1}
                        onClick={() =>
                          setTurns((current) =>
                            current.filter((item) => item.id !== turn.id),
                          )
                        }
                      >
                        台詞を削除
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={isBusy || turns.length >= 32}
                  onClick={() =>
                    setTurns((current) => [
                      ...current,
                      {
                        id: crypto.randomUUID(),
                        alias: speakers[1].alias,
                        text: "",
                        instruction: "",
                      },
                    ])
                  }
                >
                  台詞を追加
                </button>
              </fieldset>
            )}
            {!admission.canAccept && (
              <p role="alert">
                Geminiの安全余裕を含む受付上限を超えています。本文・台詞・演技指示を短くしてください。
              </p>
            )}
            <p className="app-hint">
              8192
              token制限に備えて保守的な受付判定を行います。表示のbytesはtoken数ではありません。
            </p>
          </>
        )}
        {!isGemini && !isMusic && (
          <div className="form-grid">
            {select("Elevenの音声", elevenVoice, ELEVEN_VOICES, setElevenVoice)}
            {select("言語", language, ["", ...SPEECH_LANGUAGES], setLanguage)}
            {select(
              "文字の正規化",
              normalization,
              TEXT_NORMALIZATION,
              setNormalization,
            )}
            {select(
              "TTSのMP3形式",
              speechFormat,
              SPEECH_FORMATS,
              setSpeechFormat,
            )}
            <label>
              安定性
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={stability}
                disabled={isBusy}
                onChange={(event) => setStability(Number(event.target.value))}
              />
            </label>
            <label>
              音声の類似度
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={similarityBoost}
                disabled={isBusy}
                onChange={(event) =>
                  setSimilarityBoost(Number(event.target.value))
                }
              />
            </label>
            <label>
              TTSのseed（任意）
              <input
                type="number"
                min={0}
                max={2147483647}
                step={1}
                value={seed}
                disabled={isBusy}
                onChange={(event) => setSeed(event.target.value)}
              />
            </label>
          </div>
        )}
        {isMusic && (
          <div className="form-grid">
            <label>
              音楽の秒数
              <input
                type="number"
                required
                min={3}
                max={60}
                step={1}
                value={duration}
                disabled={isBusy}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={instrumental}
                disabled={isBusy}
                onChange={(event) => setInstrumental(event.target.checked)}
              />
              インストゥルメンタル
            </label>
            {select(
              "音楽のMP3形式",
              musicFormat,
              MUSIC_FORMATS,
              setMusicFormat,
            )}
          </div>
        )}
        {!isMusic && (
          <p className="app-hint">
            本文・alias・演技指示の合計 {inputBytes} / 4000 UTF-8 bytes
          </p>
        )}
        {!isExecutable && (
          <p className="app-hint">
            この音声モデルは上流の非公開保存・保持・利用権限が未確認のため生成できません。
          </p>
        )}
        <button type="submit" disabled={!canSubmit}>
          音声生成を依頼
        </button>
        <p className="app-hint">
          完成後に再生・保存できます。待機中は生成履歴から同じ要求を確認できます。
        </p>
      </form>
    </section>
  );
}
