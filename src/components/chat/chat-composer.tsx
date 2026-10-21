import type { SubmitEvent } from "react";
import type { Source } from "./chat-stream";

export function ChatComposer({
  draft,
  sending,
  loadingHistory,
  canSubmit,
  rag,
  agent,
  onDraftChange,
  onSubmit,
  onAbort,
}: {
  draft: string;
  sending: boolean;
  loadingHistory: boolean;
  canSubmit: boolean;
  /** 機能がOFFならnull。ONなら切替の状態と変更先。 */
  rag: { checked: boolean; onChange: (checked: boolean) => void } | null;
  agent: { checked: boolean; onChange: (checked: boolean) => void } | null;
  onDraftChange: (draft: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onAbort: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="chat-composer">
      <label className="sr-only" htmlFor="chat-message">
        メッセージ
      </label>
      <textarea
        id="chat-message"
        placeholder="メッセージを入力…"
        value={draft}
        required
        maxLength={8000}
        rows={3}
        disabled={sending || loadingHistory}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <div className="composer-actions">
        <div className="feature-toggles">
          {rag && (
            <label>
              <input
                type="checkbox"
                checked={rag.checked}
                disabled={sending}
                onChange={(event) => rag.onChange(event.target.checked)}
              />
              資料を参照
            </label>
          )}
          {agent && (
            <label>
              <input
                type="checkbox"
                checked={agent.checked}
                disabled={sending}
                onChange={(event) => agent.onChange(event.target.checked)}
              />
              ツールを使用
            </label>
          )}
        </div>
        {sending ? (
          <button type="button" className="secondary" onClick={onAbort}>
            応答を中断
          </button>
        ) : (
          <button type="submit" disabled={!canSubmit}>
            送信する →
          </button>
        )}
      </div>
      <p className="app-hint">
        AIの回答は誤ることがあります。重要な内容は確認してください。
      </p>
    </form>
  );
}

/** 送信中の応答が参照した資料。保存済みの資料は`MessageList`が表示する。 */
export function StreamSources({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <details className="chat-sources">
      <summary>参照した資料（{sources.length}件）</summary>
      <ul>
        {sources.map((source, index) => (
          <li key={source.id ?? index}>
            {source.title}
            {source.text && <p>{source.text.slice(0, 300)}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}
