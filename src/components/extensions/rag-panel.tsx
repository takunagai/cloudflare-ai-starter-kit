import { useState } from "react";
import { api, errorCode } from "../api-client";
import { Failure, statusLabel, useRemote } from "./shared";

export function RagPanel() {
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
