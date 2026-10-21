import { useRef, useState } from "react";
import { api, errorCode } from "../api-client";
import { Failure, statusLabel, useRemote } from "./shared";

function imageURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return;
  }
}

export function ImagesPanel() {
  type Job = {
    id: string;
    state: string;
    image?: { url: string; width?: number; height?: number } | null;
  };
  const { data, error, setError, busy, reload } = useRemote<{ jobs: Job[] }>(
    "/api/extensions/images",
    { jobs: [] },
  );
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("square");
  const [saving, setSaving] = useState(false);
  const pendingRequest = useRef<{ key: string; id: string } | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const key = JSON.stringify([prompt, size]);
      if (pendingRequest.current?.key !== key)
        pendingRequest.current = { key, id: crypto.randomUUID() };
      await api("/api/extensions/images", {
        requestId: pendingRequest.current.id,
        model: "fal-ai/flux/schnell",
        prompt,
        size,
      });
      setPrompt("");
      pendingRequest.current = null;
      await reload();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setSaving(false);
    }
  }
  async function action(id: string, cancel = false) {
    setSaving(true);
    setError("");
    try {
      await api(
        `/api/extensions/images/${encodeURIComponent(id)}${cancel ? "/cancel" : ""}`,
        cancel ? {} : undefined,
      );
      await reload();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <h3>画像を1枚つくる</h3>
      <p className="app-hint">
        fal.aiのFLUX
        Schnellを使用します。生成には料金がかかります。取消後も処理や請求が発生する場合があります。
      </p>
      <Failure code={error} />
      <form className="app-form" onSubmit={submit}>
        <label>
          作りたい画像
          <textarea
            required
            maxLength={2000}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={saving}
          />
        </label>
        <label>
          サイズ
          <select
            value={size}
            onChange={(event) => setSize(event.target.value)}
            disabled={saving}
          >
            <option value="square">正方形</option>
            <option value="square_hd">正方形・高解像度</option>
          </select>
        </label>
        <button type="submit" disabled={saving || !prompt.trim()}>
          {saving ? "受け付けています…" : "画像を1枚生成"}
        </button>
      </form>
      <p className="app-hint">
        画像の配信URLは公開URLで、有効期限がある場合があります。機密情報を含む画像は生成しないでください。
      </p>
      <div className="image-jobs">
        {data.jobs.map((job) => (
          <article key={job.id} className="resource-card">
            <p>
              <span className="badge">{statusLabel(job.state)}</span>
            </p>
            {job.image && imageURL(job.image.url) && (
              <img
                className="generated-image"
                src={imageURL(job.image.url)}
                alt="生成した画像"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={saving}
                onClick={() => action(job.id)}
              >
                状態を確認
              </button>
              {!["completed", "succeeded", "failed", "cancelled"].includes(
                job.state,
              ) && (
                <button
                  type="button"
                  className="link-button"
                  disabled={saving}
                  onClick={() => action(job.id, true)}
                >
                  取消を依頼
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!data.jobs.length && (
        <p className="app-hint">生成した画像はまだありません。</p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={saving || busy}
        onClick={reload}
      >
        一覧を更新
      </button>
    </>
  );
}
