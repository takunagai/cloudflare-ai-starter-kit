import { useRef, useState } from "react";
import { api, errorCode, type Model } from "../api-client";
import { Failure, statusLabel, useRemote } from "./shared";

export function WorkflowsPanel({
  modelId,
  models,
}: {
  modelId: string;
  models: Model[];
}) {
  type Job = {
    id: string;
    state: string;
    summary?: string | null;
    model: string;
  };
  const { data, error, setError, busy, reload } = useRemote<{ jobs: Job[] }>(
    "/api/extensions/workflows",
    { jobs: [] },
  );
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const pendingRequest = useRef<{ key: string; id: string } | null>(null);
  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const key = JSON.stringify([modelId, input]);
      if (pendingRequest.current?.key !== key)
        pendingRequest.current = { key, id: crypto.randomUUID() };
      await api("/api/extensions/workflows", {
        requestId: pendingRequest.current.id,
        model: modelId,
        input,
      });
      setInput("");
      pendingRequest.current = null;
      await reload();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setSaving(false);
    }
  }
  async function action(id: string, decision?: "approve" | "reject") {
    setSaving(true);
    setError("");
    try {
      if (decision)
        await api(
          `/api/extensions/workflows/${encodeURIComponent(id)}/decision`,
          { decision },
        );
      else await api(`/api/extensions/workflows/${encodeURIComponent(id)}`);
      await reload();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <h3>要約を依頼して、あとから確認</h3>
      <p className="app-hint">
        要約→あなたの承認→保存を順番に行います。画面を閉じても処理状況を確認できます。
      </p>
      <p className="app-hint">
        モデル：
        {models.find((model) => model.id === modelId)?.label ??
          "チャット上部で選択してください"}
      </p>
      <Failure code={error} />
      <form className="app-form" onSubmit={start}>
        <label>
          要約する文章
          <textarea
            required
            maxLength={8000}
            rows={5}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={saving}
          />
        </label>
        <button type="submit" disabled={saving || !input.trim() || !modelId}>
          {saving ? "受け付けています…" : "要約を依頼"}
        </button>
      </form>
      <div className="resource-cards">
        {data.jobs.map((job) => (
          <article className="resource-card" key={job.id}>
            <p>
              <span className="badge">{statusLabel(job.state)}</span>
            </p>
            {job.summary && <p className="plain-text">{job.summary}</p>}
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={saving}
                onClick={() => action(job.id)}
              >
                状態を確認
              </button>
              {job.state === "awaiting_approval" && (
                <>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => action(job.id, "approve")}
                  >
                    承認して保存
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={saving}
                    onClick={() => action(job.id, "reject")}
                  >
                    却下
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {!data.jobs.length && (
        <p className="app-hint">依頼した処理はまだありません。</p>
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
