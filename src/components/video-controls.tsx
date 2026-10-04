import { useRef, useState } from "react";
import {
  CAMERA_PRESETS,
  type CameraKeyframe,
  isCameraValid,
  VIDEO_ENDPOINTS,
  VIDEO_RATIOS,
} from "../lib/media-video-options";

type Reference = {
  id: string;
  width: number;
  height: number;
  canReference: boolean;
  expiresAt: number;
};
const LABELS = [
  "テキストから動画",
  "開始・終了画像から動画",
  "順序付き参照から動画",
  "カメラ制御",
];
export function VideoControls({
  assets,
  models,
  isBusy,
  isEnabled,
  initialStart,
  submit,
}: {
  assets: Reference[];
  models: { id: string; isExecutable: boolean }[];
  isBusy: boolean;
  isEnabled: boolean;
  initialStart: string;
  submit: (request: {
    model: string;
    requestId: string;
    input: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const [model, setModel] = useState<string>(
    initialStart ? VIDEO_ENDPOINTS[1] : VIDEO_ENDPOINTS[0],
  );
  const [prompt, setPrompt] = useState(""),
    [duration, setDuration] = useState(5),
    [resolution, setResolution] = useState("768P"),
    [aspectRatio, setAspectRatio] = useState("16:9"),
    [seed, setSeed] = useState("");
  const [start, setStart] = useState(initialStart),
    [end, setEnd] = useState(""),
    [references, setReferences] = useState<string[]>([]);
  const [keyframes, setKeyframes] = useState<
    (CameraKeyframe & { id: string })[]
  >(
    CAMERA_PRESETS.静止.map((frame) => ({ ...frame, id: crypto.randomUUID() })),
  );
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const mode = VIDEO_ENDPOINTS.indexOf(
    model as (typeof VIDEO_ENDPOINTS)[number],
  );
  const candidates = assets.filter(
    (asset) => asset.canReference && asset.expiresAt >= Date.now() + 1800000,
  );
  const hasSources =
    (mode !== 1 || !!(start || end)) &&
    (mode !== 2 || references.length > 0) &&
    (mode !== 3 || !!start);
  const areSourcesValid = (
    mode === 0
      ? []
      : mode === 1
        ? [start, end]
        : mode === 2
          ? [start, end, ...references]
          : [start]
  )
    .filter(Boolean)
    .every((id) => candidates.some((asset) => asset.id === id));
  const isExecutable = models.some(
    (item) => item.id === model && item.isExecutable,
  );
  const canSubmit =
    isEnabled &&
    !isBusy &&
    isExecutable &&
    !!prompt.trim() &&
    hasSources &&
    areSourcesValid &&
    (mode !== 3 || isCameraValid(keyframes));
  const sourceSelect = (
    label: string,
    value: string,
    change: (value: string) => void,
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={isBusy}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">指定しない</option>
        {candidates.map((asset, index) => (
          <option key={asset.id} value={asset.id}>
            画像 {index + 1} · {asset.width} × {asset.height}
          </option>
        ))}
      </select>
      {value && candidates.some((asset) => asset.id === value) && (
        <img
          className="generated-image"
          src={`/api/media/assets/${value}/file`}
          alt={label}
          referrerPolicy="no-referrer"
        />
      )}
    </label>
  );
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const input = {
      prompt,
      duration,
      resolution,
      ...(seed === "" ? {} : { seed: Number(seed) }),
      ...(mode === 0 || mode === 2 ? { aspectRatio } : {}),
      ...(mode !== 0 && start ? { start } : {}),
      ...(mode === 1 || mode === 2 ? (end ? { end } : {}) : {}),
      ...(mode === 2 ? { references } : {}),
      ...(mode === 3
        ? { keyframes: keyframes.map(({ id: _id, ...frame }) => frame) }
        : {}),
    };
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
      <h2>動画を作る</h2>
      <form className="app-form" onSubmit={generate}>
        <label>
          動画モデル
          <select
            value={model}
            disabled={isBusy}
            onChange={(event) => {
              const next = event.target.value;
              setModel(next);
              setResolution(next === VIDEO_ENDPOINTS[3] ? "480P" : "768P");
              setAspectRatio(next === VIDEO_ENDPOINTS[2] ? "adaptive" : "16:9");
            }}
          >
            {VIDEO_ENDPOINTS.filter((id) =>
              models.some((item) => item.id === id),
            ).map((id) => (
              <option key={id} value={id}>
                H3 Max · {LABELS[VIDEO_ENDPOINTS.indexOf(id)]}
              </option>
            ))}
          </select>
        </label>
        <label>
          動画の説明
          <textarea
            value={prompt}
            required
            maxLength={4000}
            disabled={isBusy}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            動画の秒数
            <select
              value={duration}
              disabled={isBusy}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              <option value={5}>5秒</option>
              <option value={10}>10秒</option>
            </select>
          </label>
          <label>
            解像度
            <select
              value={resolution}
              disabled={isBusy}
              onChange={(event) => setResolution(event.target.value)}
            >
              {["480P", "768P", "1080P"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {(mode === 0 || mode === 2) && (
            <label>
              動画の縦横比
              <select
                value={aspectRatio}
                disabled={isBusy}
                onChange={(event) => setAspectRatio(event.target.value)}
              >
                {[...(mode === 2 ? ["adaptive"] : []), ...VIDEO_RATIOS].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </label>
          )}
          <label>
            動画のseed（任意）
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
        {mode !== 0 && sourceSelect("開始画像", start, setStart)}
        {(mode === 1 || mode === 2) && sourceSelect("終了画像", end, setEnd)}
        {mode === 1 && !hasSources && (
          <p className="app-hint">
            開始画像か終了画像を少なくとも1枚選択してください。
          </p>
        )}
        {mode === 2 && (
          <fieldset>
            <legend>参照画像（1〜4枚・順序を保持）</legend>
            {sourceSelect("参照画像を追加", "", (id) => {
              if (id && references.length < 4 && !references.includes(id))
                setReferences((current) => [...current, id]);
            })}
            {references.map((id, index) => (
              <div key={id} className="resource-card">
                <p>参照 {index + 1}</p>
                <img
                  className="generated-image"
                  src={`/api/media/assets/${id}/file`}
                  alt={`動画参照 ${index + 1}`}
                  referrerPolicy="no-referrer"
                />
                <div className="button-row">
                  <button
                    type="button"
                    disabled={isBusy || index === 0}
                    onClick={() =>
                      setReferences((current) => {
                        const next = [...current];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        return next;
                      })
                    }
                  >
                    動画参照を前へ
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || index === references.length - 1}
                    onClick={() =>
                      setReferences((current) => {
                        const next = [...current];
                        [next[index + 1], next[index]] = [
                          next[index],
                          next[index + 1],
                        ];
                        return next;
                      })
                    }
                  >
                    動画参照を後へ
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      setReferences((current) =>
                        current.filter((value) => value !== id),
                      )
                    }
                  >
                    動画参照を外す
                  </button>
                </div>
              </div>
            ))}
          </fieldset>
        )}
        {mode === 3 && (
          <fieldset>
            <legend>カメラのキーフレーム</legend>
            <p className="app-hint">
              時刻は0〜1（秒数に比例）。先頭0・末尾1、昇順、2〜12行。方位の総移動は720度まで。仰角−90〜90度、距離0.1〜10。
            </p>
            <div className="button-row">
              {Object.entries(CAMERA_PRESETS).map(([name, frames]) => (
                <button
                  type="button"
                  key={name}
                  disabled={isBusy}
                  onClick={() =>
                    setKeyframes(
                      frames.map((frame) => ({
                        ...frame,
                        id: crypto.randomUUID(),
                      })),
                    )
                  }
                >
                  {name}
                </button>
              ))}
            </div>
            {keyframes.map((frame, index) => (
              <div className="form-grid" key={frame.id}>
                {(["time", "azimuth", "elevation", "distance"] as const).map(
                  (field, position) => (
                    <label key={field}>
                      {["時刻", "方位角", "仰角", "距離"][position]} {index + 1}
                      <input
                        type="number"
                        step="any"
                        value={frame[field]}
                        disabled={isBusy}
                        onChange={(event) =>
                          setKeyframes((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    [field]: Number(event.target.value),
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  ),
                )}
                <span>{(frame.time * duration).toFixed(2)}秒</span>
                <button
                  type="button"
                  disabled={
                    isBusy || index === 0 || index === keyframes.length - 1
                  }
                  onClick={() =>
                    setKeyframes((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  キーを削除
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={isBusy || keyframes.length >= 12}
              onClick={() =>
                setKeyframes((current) => [
                  ...current.slice(0, -1),
                  {
                    ...current[current.length - 2],
                    id: crypto.randomUUID(),
                    time: (current[current.length - 2].time + 1) / 2,
                  },
                  current[current.length - 1],
                ])
              }
            >
              キーを追加
            </button>
            {!isCameraValid(keyframes) && (
              <p role="alert">カメラの時刻・角度・距離を確認してください。</p>
            )}
          </fieldset>
        )}
        {!areSourcesValid && (
          <p role="alert">
            選択した画像は期限・削除状態により利用できません。選び直してください。
          </p>
        )}
        {!isExecutable && (
          <p className="app-hint">
            この動画モデルの実生成は利用できません。管理者による上流の非公開保存・保持・回収条件の確認が必要です。
          </p>
        )}
        <button type="submit" disabled={!canSubmit}>
          動画生成を依頼
        </button>
        <p className="app-hint">
          受付後は生成履歴で状態を確認できます。再読込で同じジョブを確認し、受付不明時は再送しません。
        </p>
      </form>
    </section>
  );
}
