import { useState } from "react";
import { api, errorCode } from "../api-client";
import { Failure, statusLabel, useRemote } from "./shared";

export function AgentPanel({ revision }: { revision: number }) {
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
