import type { Ref } from "react";
import { safeCode } from "../api-client";
import type { Message } from "./chat-stream";

export function MessageList({
  messages,
  loadingHistory,
  sending,
  emptyTitle,
  endRef,
}: {
  messages: Message[];
  loadingHistory: boolean;
  sending: boolean;
  emptyTitle?: string;
  endRef: Ref<HTMLDivElement>;
}) {
  return (
    <div className="message-list" aria-busy={sending || loadingHistory}>
      {loadingHistory ? (
        <p role="status">履歴を読み込んでいます…</p>
      ) : messages.length ? (
        messages.map((message) => (
          <article
            key={message.id}
            className={`chat-message ${message.role === "user" ? "user-message" : "assistant-message"}`}
          >
            <p className="message-author">
              {message.role === "user" ? "あなた" : "アシスタント"}
            </p>
            <div className="message-content">
              {message.content ||
                (sending
                  ? "応答を待っています…"
                  : "応答は保存されていません。")}
            </div>
            {!!message.sources?.length && (
              <details className="saved-sources">
                <summary>参照した資料（{message.sources.length}件）</summary>
                <ul>
                  {message.sources.map((source) => (
                    <li key={source.id}>
                      <strong>{source.title}</strong>
                      {source.text && <p>{source.text.slice(0, 300)}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!["complete", "completed", "streaming", "pending"].includes(
              message.status,
            ) && <p className="app-hint">状態：{safeCode(message.status)}</p>}
          </article>
        ))
      ) : (
        <div className="chat-empty">
          <span aria-hidden="true">✳</span>
          <h2>{emptyTitle ?? "いま、何を進めましょう？"}</h2>
          <p>
            アイデアの整理、文章の下書き、仕事の相談。
            <br />
            下の入力欄から会話を始められます。
          </p>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
