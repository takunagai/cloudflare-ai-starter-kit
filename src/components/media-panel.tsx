import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { extensionFailureMessage } from "../lib/extension-errors";
import {
  IMAGE_ENDPOINTS,
  IMAGE_PRESETS,
  IMAGE_QUALITIES,
} from "../lib/media-image-options";
import { api, ClientError, errorCode, responseError } from "./api-client";
import { AudioControls } from "./audio-controls";
import { AssetList } from "./media/asset-list";
import { JobHistory } from "./media/job-history";
import type { Asset, Job, MediaModel } from "./media/media-types";
import { VideoControls } from "./video-controls";

const modelLabel = (id: string) =>
  `${id.includes("/flare/") ? "Flare" : "Sunburst"} · ${id.endsWith("/edit") ? "参照画像の編集" : "テキストから生成"}`;

export function MediaPanel() {
  const [session, setSession] = useState<{
    identity: unknown;
    features: { media?: boolean };
  } | null>(null);
  const [models, setModels] = useState<MediaModel[]>([]),
    [assets, setAssets] = useState<Asset[]>([]),
    [jobs, setJobs] = useState<Job[]>([]);
  const [model, setModel] = useState<string>(IMAGE_ENDPOINTS[0]),
    [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("square"),
    [width, setWidth] = useState(1024),
    [height, setHeight] = useState(1024);
  const [quality, setQuality] = useState("medium"),
    [count, setCount] = useState(1),
    [format, setFormat] = useState("png"),
    [background, setBackground] = useState("auto"),
    [compression, setCompression] = useState(80);
  const [references, setReferences] = useState<string[]>([]),
    [mask, setMask] = useState("");
  const [isBusy, setIsBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [videoStart, setVideoStart] = useState("");
  const requestRef = useRef<{ input: string; id: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isEdit = model.endsWith("/edit"),
    isEnabled = session?.features.media === true;
  const isExecutable = models.some(
    (item) => item.id === model && item.isExecutable,
  );
  const selectedAssets = references.map((id) =>
    assets.find((asset) => asset.id === id),
  );
  const target = selectedAssets[0];
  const load = useCallback(async () => {
    const current = await api<{
      identity: unknown;
      features: { media?: boolean };
    }>("/api/session");
    setSession(current);
    if (!current.identity) return;
    const [assetData, jobData] = await Promise.all([
      api<{ assets: Asset[] }>("/api/media/assets"),
      api<{ jobs: Job[] }>("/api/media/jobs"),
    ]);
    setAssets(assetData.assets);
    setJobs(jobData.jobs);
    if (current.features.media) {
      const data = await api<{ models: MediaModel[] }>("/api/media/models");
      setModels(data.models);
    } else setModels([]);
  }, []);
  useEffect(() => {
    load().catch((caught) => setError(errorCode(caught)));
  }, [load]);
  async function run(operation: () => Promise<void>) {
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      await load().catch((caught) => setError(errorCode(caught)));
      setIsBusy(false);
    }
  }
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    await run(async () => {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        !file.size ||
        file.size > 10 * 1024 * 1024
      )
        throw new ClientError("media_upload_limit");
      const reservation = await api<{ id: string; uploadPath: string }>(
        "/api/media/assets",
        { bytes: file.size, contentType: file.type },
      );
      const response = await fetch(reservation.uploadPath, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": file.type },
        body: file,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new ClientError(
          responseError(await response.json().catch(() => ({}))),
        );
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setNotice("参照画像を保存しました。検証完了から7日で期限を迎えます。");
    });
  }
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const input = {
        prompt,
        size: size === "custom" ? { width, height } : size,
        quality,
        count,
        format,
        background,
        ...(format !== "png" ? { compression } : {}),
        ...(isEdit ? { references, ...(mask ? { mask } : {}) } : {}),
      };
      const key = JSON.stringify([model, input]);
      if (requestRef.current?.input !== key)
        requestRef.current = {
          input: key,
          id: `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
        };
      await api("/api/media/jobs", {
        requestId: requestRef.current.id,
        model,
        input,
      });
      setNotice(
        "受付を記録しました。「状態を確認」から同じ要求の生成・回収状況を確認できます。",
      );
    });
  }
  function reorder(index: number, delta: number) {
    setReferences((current) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
    setMask("");
  }
  if (!session)
    return (
      <main id="main" className="container section">
        <h1>画像と素材</h1>
        <p role={error ? "alert" : "status"}>
          {error
            ? `読み込めませんでした：${error}`
            : "ログイン状態を確認しています…"}
        </p>
      </main>
    );
  if (!session.identity)
    return (
      <main id="main" className="container section">
        <h1>画像と素材</h1>
        <p>ログインすると、自分の素材と生成履歴を管理できます。</p>
        <Link to="/app">ワークスペースでログイン</Link>
      </main>
    );
  return (
    <main
      id="main"
      className="container section media-workspace"
      aria-busy={isBusy}
    >
      <h1>画像と素材</h1>
      <p className="intro">
        参照画像は7日、生成した画像・動画・音声は最初の保存から30日。再利用で期限は延長されません。
      </p>
      {!isEnabled && (
        <p className="app-notice">
          新しいアップロードと生成は停止中です。自分の素材の閲覧・削除と、ジョブの取消依頼は利用できます。
        </p>
      )}
      {error && (
        <p role="alert" className="app-error">
          {extensionFailureMessage(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="app-notice">
          {notice}
        </p>
      )}
      <section className="resource-card">
        <h2>参照画像を登録</h2>
        <p className="app-hint">
          静止画PNG・JPEG・WebP、1枚10
          MiBまで。最大辺4096・最大8,294,400画素。生成要求の参照とマスクは合計50
          MiBまで。
        </p>
        <form className="app-form" onSubmit={upload}>
          <label>
            画像ファイル
            <input
              type="file"
              ref={fileRef}
              accept="image/png,image/jpeg,image/webp"
              disabled={isBusy || !isEnabled}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button disabled={isBusy || !isEnabled || !file} type="submit">
            検証してアップロード
          </button>
        </form>
      </section>
      <section className="resource-card">
        <h2>画像を作る・編集する</h2>
        <form className="app-form" onSubmit={generate}>
          <label>
            画像モデル
            <select
              value={model}
              disabled={isBusy || !isEnabled}
              onChange={(event) => {
                setModel(event.target.value);
                setMask("");
                setSize(
                  event.target.value.endsWith("/edit") ? "auto" : "square",
                );
              }}
            >
              {IMAGE_ENDPOINTS.map((id) => (
                <option
                  key={id}
                  value={id}
                  disabled={!models.some((item) => item.id === id)}
                >
                  {modelLabel(id)}
                  {models.some((item) => item.id === id)
                    ? ""
                    : "（許可対象外）"}
                </option>
              ))}
            </select>
          </label>
          {!isExecutable && (
            <p className="app-notice">
              このモデルの実生成は利用準備中です。保存・非公開回収の条件を確認した後に有効になります。
            </p>
          )}
          <label>
            作りたい画像
            <textarea
              rows={4}
              maxLength={8000}
              required
              value={prompt}
              disabled={isBusy || !isEnabled}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="media-settings">
            <label>
              サイズ
              <select
                value={size}
                disabled={isBusy || !isEnabled}
                onChange={(event) => setSize(event.target.value)}
              >
                {isEdit && <option value="auto">参照画像から自動</option>}
                {Object.entries(IMAGE_PRESETS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.width} × {value.height}
                  </option>
                ))}
                <option value="custom">寸法を指定</option>
              </select>
            </label>
            {size === "custom" && (
              <>
                <label>
                  幅
                  <input
                    type="number"
                    min={16}
                    max={3840}
                    step={16}
                    value={width}
                    disabled={isBusy}
                    onChange={(event) => setWidth(Number(event.target.value))}
                  />
                </label>
                <label>
                  高さ
                  <input
                    type="number"
                    min={16}
                    max={3840}
                    step={16}
                    value={height}
                    disabled={isBusy}
                    onChange={(event) => setHeight(Number(event.target.value))}
                  />
                </label>
              </>
            )}
            <label>
              品質
              <select
                value={quality}
                disabled={isBusy || !isEnabled}
                onChange={(event) => setQuality(event.target.value)}
              >
                {IMAGE_QUALITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              枚数
              <input
                type="number"
                min={1}
                max={4}
                value={count}
                disabled={isBusy || !isEnabled}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </label>
            <label>
              形式
              <select
                value={format}
                disabled={isBusy || !isEnabled}
                onChange={(event) => {
                  setFormat(event.target.value);
                  if (
                    event.target.value === "jpeg" &&
                    background === "transparent"
                  )
                    setBackground("opaque");
                }}
              >
                {["png", "jpeg", "webp"].map((value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              背景
              <select
                value={background}
                disabled={isBusy || !isEnabled}
                onChange={(event) => setBackground(event.target.value)}
              >
                <option value="auto">自動</option>
                <option value="opaque">不透明</option>
                <option value="transparent" disabled={format === "jpeg"}>
                  透明
                </option>
              </select>
            </label>
            {format !== "png" && (
              <label>
                圧縮率
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={compression}
                  disabled={isBusy}
                  onChange={(event) =>
                    setCompression(Number(event.target.value))
                  }
                />
              </label>
            )}
          </div>
          <p className="app-hint">
            寸法は16の倍数、最大辺3840、比率3:1以内、655,360〜8,294,400画素。品質と枚数によって費用・待ち時間が変わります。
          </p>
          {isEdit && (
            <>
              <h3>参照画像の順序（1〜8枚）</h3>
              <ol>
                {references.map((id, index) => (
                  <li key={id}>
                    <img
                      className="media-reference-thumbnail"
                      src={`/api/media/assets/${id}/file`}
                      alt={`参照順序 ${index + 1} の画像`}
                      referrerPolicy="no-referrer"
                    />
                    {assets.find((asset) => asset.id === id)?.source ===
                    "result"
                      ? "生成画像"
                      : "参照画像"}{" "}
                    {index + 1}
                    <div className="button-row">
                      <button
                        type="button"
                        className="secondary"
                        disabled={isBusy || index === 0}
                        onClick={() => reorder(index, -1)}
                      >
                        上へ
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={isBusy || index === references.length - 1}
                        onClick={() => reorder(index, 1)}
                      >
                        下へ
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        disabled={isBusy}
                        onClick={() => {
                          setReferences((items) =>
                            items.filter((item) => item !== id),
                          );
                          setMask("");
                        }}
                      >
                        選択を外す
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <label>
                マスク（先頭画像に適用）
                <select
                  value={mask}
                  disabled={isBusy || !target}
                  onChange={(event) => setMask(event.target.value)}
                >
                  <option value="">使用しない</option>
                  {assets
                    .filter(
                      (asset) =>
                        asset.canReference &&
                        asset.format === "png" &&
                        asset.hasAlpha &&
                        !references.includes(asset.id),
                    )
                    .map((asset) => (
                      <option
                        key={asset.id}
                        value={asset.id}
                        disabled={
                          target?.format !== "png" ||
                          asset.width !== target?.width ||
                          asset.height !== target?.height
                        }
                      >
                        PNG · {asset.width} × {asset.height}
                      </option>
                    ))}
                </select>
              </label>
              <p className="app-hint">
                マスクは先頭画像と同寸法の、透明度を持つPNG。透明部分（□）を編集し、不透明部分（■）を保持する指定です。編集結果の厳密な一致は保証されません。
              </p>
            </>
          )}
          <button
            type="submit"
            disabled={
              isBusy ||
              !isEnabled ||
              !isExecutable ||
              !prompt.trim() ||
              (isEdit && !references.length)
            }
          >
            この設定で生成を依頼
          </button>
          <p className="app-hint">
            受付不明の場合は要求を再送しません。取消依頼だけでは停止・返金を保証しません。
          </p>
        </form>
      </section>
      <VideoControls
        key={videoStart}
        initialStart={videoStart}
        assets={assets}
        models={models}
        isBusy={isBusy}
        isEnabled={isEnabled}
        submit={async (request) => {
          await run(async () => {
            await api("/api/media/jobs", request);
            setNotice(
              "動画の受付を記録しました。生成履歴から状態を確認できます。",
            );
          });
        }}
      />
      <AudioControls
        models={models}
        isBusy={isBusy}
        isEnabled={isEnabled}
        submit={async (request) => {
          await run(async () => {
            await api("/api/media/jobs", request);
            setNotice(
              "音声の受付を記録しました。生成履歴から状態を確認できます。",
            );
          });
        }}
      />
      <AssetList
        assets={assets}
        references={references}
        isBusy={isBusy}
        isEnabled={isEnabled}
        onVideoStart={setVideoStart}
        onReference={(id) => {
          setModel((current) =>
            current.includes("/flare/")
              ? IMAGE_ENDPOINTS[3]
              : IMAGE_ENDPOINTS[1],
          );
          setSize("auto");
          setReferences((current) => [...current, id]);
          if (mask === id) setMask("");
        }}
        onDelete={(id) => {
          void run(async () => {
            await api(`/api/media/assets/${id}`, undefined, "DELETE");
            setReferences((current) => current.filter((entry) => entry !== id));
            if (mask === id) setMask("");
            setNotice(
              "物理削除を確認しました。既に上流へ渡ったコピーの削除を意味しません。",
            );
          });
        }}
      />
      <JobHistory
        jobs={jobs}
        isBusy={isBusy}
        isEnabled={isEnabled}
        run={run}
        onNotice={setNotice}
      />
    </main>
  );
}
