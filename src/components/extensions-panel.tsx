import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ClientError,
  errorCode,
  type Features,
  type Model,
  safeCode,
} from "./api-client";

function useRemote<T>(path: string, initial: T, revision = 0) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await api<T>(path));
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }, [path]);
  useEffect(() => {
    void revision;
    void reload();
  }, [reload, revision]);
  return { data, error, setError, busy, reload };
}

function Failure({ code }: { code: string }) {
  return code ? (
    <p className="app-error" role="alert">
      処理できませんでした：{code}
    </p>
  ) : null;
}

const statusLabels: Record<string, string> = {
  pending_index: "検索の準備中",
  ready: "準備完了",
  queued: "受付済み",
  pending: "受付済み",
  running: "処理中",
  completed: "完了",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "取消済み",
  cancel_requested: "取消を依頼済み",
  timed_out: "処理状況の再確認が必要",
  awaiting_approval: "承認待ち",
  approved: "承認済み",
  rejected: "却下済み",
  expired: "期限切れ",
  active: "有効",
  trialing: "試用中",
  past_due: "支払い確認が必要",
  canceled: "解約済み",
  inactive: "無効",
  accepted: "受付済み",
};
function statusLabel(value: string) {
  return statusLabels[value] ?? safeCode(value);
}

function RagPanel() {
  type Document = { id: string; title: string; state: string };
  const { data, error, setError, busy, reload } = useRemote<{
    documents: Document[];
  }>("/api/extensions/rag/documents", { documents: [] });
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api("/api/extensions/rag/documents", { title: title.trim(), text });
      setTitle("");
      setText("");
      setNotice(
        "資料を登録しました。検索に反映されるまで時間がかかる場合があります。",
      );
      await reload();
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm("この資料を削除しますか？")) return;
    setSaving(true);
    try {
      await api(
        `/api/extensions/rag/documents/${encodeURIComponent(id)}`,
        undefined,
        "DELETE",
      );
      setNotice(
        "資料を削除しました。検索インデックスへの反映には時間がかかる場合があります。",
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
      <h3>会話に使う資料</h3>
      <p className="app-hint">
        登録後、チャットの「資料を参照」を有効にします。資料はあなたのアカウントで管理します。
      </p>
      <Failure code={error} />
      <form className="app-form" onSubmit={upload}>
        <label>
          資料名
          <input
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={saving}
          />
        </label>
        <label>
          本文
          <textarea
            required
            rows={5}
            maxLength={50000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={saving}
            placeholder="検索に使うテキストを貼り付けてください"
          />
        </label>
        <button
          disabled={saving || !title.trim() || !text.trim()}
          type="submit"
        >
          {saving ? "登録しています…" : "資料を登録"}
        </button>
      </form>
      {notice && (
        <p role="status" className="app-notice">
          {notice}
        </p>
      )}
      <ul className="resource-list">
        {data.documents.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span className="badge">{statusLabel(item.state)}</span>
            </div>
            <button
              className="link-button danger"
              type="button"
              disabled={saving}
              onClick={() => remove(item.id)}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
      {!data.documents.length && !busy && (
        <p className="app-hint">資料はまだありません。</p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={busy || saving}
        onClick={reload}
      >
        一覧を更新
      </button>
    </>
  );
}

function AgentPanel({ revision }: { revision: number }) {
  type Approval = {
    id: string;
    title: string;
    content: string;
    status: string;
  };
  const approvals = useRemote<{ approvals: Approval[] }>(
    "/api/approvals",
    { approvals: [] },
    revision,
  );
  const notes = useRemote<{
    notes: { id: string; title: string; content: string }[];
  }>("/api/notes", { notes: [] }, revision);
  const [saving, setSaving] = useState(false);
  async function decide(id: string, decision: "approve" | "reject") {
    setSaving(true);
    approvals.setError("");
    try {
      await api(`/api/approvals/${encodeURIComponent(id)}`, { decision });
      await Promise.all([approvals.reload(), notes.reload()]);
    } catch (caught) {
      approvals.setError(errorCode(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <h3>保存する前に、内容を確認</h3>
      <p className="app-hint">
        チャットで「ツールを使用」を有効にすると、メモの下書きを作れます。承認した内容だけが保存されます。
      </p>
      <Failure code={approvals.error || notes.error} />
      <div className="resource-cards">
        {approvals.data.approvals.map((item) => (
          <article key={item.id} className="resource-card">
            <div className="section-heading">
              <h4>{item.title}</h4>
              <span className="badge">{statusLabel(item.status)}</span>
            </div>
            <p className="plain-text">{item.content}</p>
            {["pending", "awaiting_approval"].includes(item.status) && (
              <div className="button-row">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => decide(item.id, "approve")}
                >
                  承認して保存
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => decide(item.id, "reject")}
                >
                  却下
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!approvals.data.approvals.length && (
        <p className="app-hint">確認待ちの下書きはありません。</p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={saving || approvals.busy || notes.busy}
        onClick={() => {
          void approvals.reload();
          void notes.reload();
        }}
      >
        状態を更新
      </button>
      <h3 className="subsection-title">保存したメモ</h3>
      {notes.data.notes.map((note) => (
        <details key={note.id} className="resource-card">
          <summary>{note.title}</summary>
          <p className="plain-text">{note.content}</p>
        </details>
      ))}
      {!notes.data.notes.length && (
        <p className="app-hint">保存したメモはまだありません。</p>
      )}
    </>
  );
}

function WorkflowsPanel({
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

function ImagesPanel() {
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

function BillingPanel() {
  const { data, error, setError, busy, reload } = useRemote<{
    subscription: { status: string } | null;
  }>("/api/billing/status", { subscription: null });
  const [opening, setOpening] = useState(false);
  const [checkingMember, setCheckingMember] = useState(false);
  const [memberMessage, setMemberMessage] = useState("");
  async function checkMember() {
    setCheckingMember(true);
    setMemberMessage("");
    setError("");
    try {
      const result = await api<{ message: unknown }>("/api/billing/member");
      if (typeof result.message !== "string")
        throw new ClientError("invalid_billing_response");
      setMemberMessage(result.message);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setCheckingMember(false);
    }
  }
  async function open(kind: "checkout" | "portal") {
    setOpening(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/api/billing/${kind}`, {});
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        !(url.hostname === "polar.sh" || url.hostname.endsWith(".polar.sh"))
      )
        throw new ClientError("invalid_billing_redirect");
      window.location.assign(url.href);
    } catch (caught) {
      setError(errorCode(caught));
      setOpening(false);
    }
  }
  return (
    <>
      <h3>プランと契約</h3>
      <p>
        契約状態：
        {data.subscription ? statusLabel(data.subscription.status) : "契約なし"}
      </p>
      <p className="app-hint">
        手続きはPolarの画面で行います。購入内容・金額・sandbox表示を確認してから確定してください。
      </p>
      <Failure code={error} />
      <div className="button-row">
        <button
          type="button"
          disabled={opening || checkingMember || busy}
          onClick={() => open("checkout")}
        >
          プランを確認
        </button>
        <button
          type="button"
          className="secondary"
          disabled={opening || checkingMember || busy || !data.subscription}
          onClick={() => open("portal")}
        >
          契約を管理
        </button>
        <button
          type="button"
          className="link-button"
          disabled={opening || checkingMember || busy}
          onClick={reload}
        >
          状態を更新
        </button>
        <button
          type="button"
          className="secondary"
          disabled={opening || checkingMember || busy}
          onClick={checkMember}
        >
          {checkingMember ? "確認しています…" : "会員機能を確認"}
        </button>
      </div>
      {memberMessage && <p role="status">{memberMessage}</p>}
    </>
  );
}

// mediaとdecisionsは専用画面を持つため、このパネルのタブにしない。
type PanelFeature = Exclude<keyof Features, "media" | "decisions">;

export function ExtensionsPanel({
  features,
  models,
  modelId,
  revision,
}: {
  features: Features;
  models: Model[];
  modelId: string;
  revision: number;
}) {
  const [active, setActive] = useState<PanelFeature | null>(null);
  const labels: Record<PanelFeature, string> = {
    rag: "資料",
    agent: "承認とメモ",
    workflows: "長時間処理",
    images: "画像生成",
    billing: "プラン",
  };
  const enabled = (Object.keys(labels) as PanelFeature[]).filter(
    (key) => features[key],
  );
  if (!enabled.length) return null;
  return (
    <section className="extensions">
      <h2>必要な仕事を、ここから</h2>
      <div className="extension-tabs">
        {enabled.map((key) => (
          <button
            type="button"
            key={key}
            className={active === key ? "" : "secondary"}
            aria-pressed={active === key}
            onClick={() => setActive(active === key ? null : key)}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      {active && features[active] && (
        <div className="extension-body">
          {active === "rag" && <RagPanel />}
          {active === "agent" && <AgentPanel revision={revision} />}
          {active === "workflows" && (
            <WorkflowsPanel models={models} modelId={modelId} />
          )}
          {active === "images" && <ImagesPanel />}
          {active === "billing" && <BillingPanel />}
        </div>
      )}
    </section>
  );
}
