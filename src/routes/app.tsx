import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ClientError,
  errorCode,
  type Features,
  type Model,
  responseError,
  safeCode,
} from "../components/api-client";
import { AuthPanel } from "../components/auth-panel";
import { ExtensionsPanel } from "../components/extensions-panel";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "ワークスペース | Cloudflare AI Starter" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Workspace,
});

type Session = {
  identity: { id: string; email: string; name: string } | null;
  authMode: string;
  googleEnabled: boolean;
  localDemo: boolean;
  features: Features;
};
type Conversation = { id: string; title: string; updated_at?: number };
type Message = {
  id: string;
  role: string;
  content: string;
  status: string;
  sources?: Source[];
};
type Source = { id: string; title: string; text?: string };
type StreamEvent = {
  type: string;
  text?: string;
  code?: string;
  sources?: Source[];
};

async function consumeEvents(
  response: Response,
  receive: (event: StreamEvent) => void,
) {
  if (!response.body) throw new ClientError("empty_stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 262144) throw new ClientError("invalid_stream");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          let event: StreamEvent;
          try {
            event = JSON.parse(data) as StreamEvent;
          } catch {
            throw new ClientError("invalid_stream");
          }
          if (!event || typeof event.type !== "string")
            throw new ClientError("invalid_stream");
          receive(event);
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function Workspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const [error, setError] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [useRag, setUseRag] = useState(false);
  const [useAgent, setUseAgent] = useState(false);
  const [revision, setRevision] = useState(0);
  const [extensionVersion, setExtensionVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const currentConversation = conversations.find(
    (item) => item.id === selected,
  );
  const identityId = resetMode ? undefined : session?.identity?.id;

  const loadSession = useCallback(async () => {
    const data = await api<Session>("/api/session");
    setSession(data);
    setError("");
  }, []);
  const loadConversations = useCallback(async () => {
    const data = await api<{ conversations: Conversation[] }>(
      "/api/conversations",
    );
    setConversations(data.conversations);
  }, []);

  useEffect(() => {
    setResetMode(new URL(window.location.href).searchParams.has("token"));
    loadSession().catch((caught) => setError(errorCode(caught)));
    return () => controller.current?.abort();
  }, [loadSession]);
  useEffect(() => {
    if (!identityId) return;
    let active = true;
    Promise.all([
      api<{ models: Model[] }>("/api/models"),
      api<{ conversations: Conversation[] }>("/api/conversations"),
    ])
      .then(([modelData, history]) => {
        if (!active) return;
        setModels(modelData.models);
        setModelId(modelData.models.find((item) => item.available)?.id ?? "");
        setConversations(history.conversations);
      })
      .catch((caught) => {
        if (active) setError(errorCode(caught));
      });
    return () => {
      active = false;
    };
  }, [identityId]);
  useEffect(() => {
    void revision;
    if (!selected || !identityId || controller.current) return;
    let active = true;
    setLoadingHistory(true);
    api<{ messages: Message[] }>(
      `/api/conversations/${encodeURIComponent(selected)}`,
    )
      .then((data) => {
        if (active) {
          setMessages(data.messages);
          setSources([]);
        }
      })
      .catch((caught) => {
        if (active) setError(errorCode(caught));
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
    };
  }, [selected, identityId, revision]);
  useEffect(() => {
    if (messages.length) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  function newConversation() {
    setSelected(null);
    setMessages([]);
    setSources([]);
    setError("");
    setNotice("");
    setDraft("");
    setLoadingHistory(false);
  }
  async function removeConversation() {
    if (
      !selected ||
      sending ||
      !window.confirm("この会話と履歴を削除しますか？")
    )
      return;
    try {
      await api(
        `/api/conversations/${encodeURIComponent(selected)}`,
        undefined,
        "DELETE",
      );
      newConversation();
      await loadConversations();
    } catch (caught) {
      setError(errorCode(caught));
    }
  }
  async function logout() {
    if (session?.authMode === "access") {
      window.location.assign("/cdn-cgi/access/logout");
      return;
    }
    try {
      await api("/api/auth/sign-out", {});
      newConversation();
      setConversations([]);
      setModels([]);
      await loadSession();
    } catch (caught) {
      setError(errorCode(caught));
    }
  }
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending || !modelId || loadingHistory) return;
    const abort = new AbortController();
    controller.current = abort;
    setSending(true);
    setError("");
    setNotice("");
    setSources([]);
    let conversationId = selected;
    const assistantId = crypto.randomUUID();
    let finished = false;
    try {
      if (!conversationId) {
        const created = await api<{ conversation: Conversation }>(
          "/api/conversations",
          { title: message.slice(0, 60) },
        );
        conversationId = created.conversation.id;
        setSelected(conversationId);
        setConversations((items) => [created.conversation, ...items]);
      }
      if (abort.signal.aborted) return;
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: message,
          status: "pending",
        },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          status: "streaming",
        },
      ]);
      setDraft("");
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          conversationId,
          requestId: crypto.randomUUID(),
          modelId,
          message,
          ...(useRag && session?.features.rag ? { rag: true } : {}),
          ...(useAgent && session?.features.agent ? { agent: true } : {}),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ClientError(responseError(data));
      }
      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const data = await response.json();
        if (
          typeof data !== "object" ||
          data === null ||
          !("replayed" in data) ||
          data.replayed !== true
        )
          throw new ClientError("invalid_chat_response");
        finished = true;
      } else {
        await consumeEvents(response, (item) => {
          if (item.type === "delta" && typeof item.text === "string")
            setMessages((items) =>
              items.map((entry) =>
                entry.id === assistantId
                  ? { ...entry, content: entry.content + item.text }
                  : entry,
              ),
            );
          if (item.type === "finish") finished = true;
          if (item.type === "error") throw new ClientError(safeCode(item.code));
          if (item.type === "sources" && Array.isArray(item.sources))
            setSources(item.sources);
          if (item.type === "approval") {
            setExtensionVersion((value) => value + 1);
            setNotice(
              "保存前の承認が必要です。下の「承認とメモ」を確認してください。",
            );
          }
        });
      }
      if (!finished) throw new ClientError("stream_interrupted");
    } catch (caught) {
      if (abort.signal.aborted)
        setNotice("応答を中断しました。履歴を再取得します。");
      else setError(errorCode(caught));
      setMessages((items) =>
        items.map((entry) =>
          entry.id === assistantId ? { ...entry, status: "failed" } : entry,
        ),
      );
    } finally {
      controller.current = null;
      setSending(false);
      setRevision((value) => value + 1);
      loadConversations().catch((caught) => setError(errorCode(caught)));
    }
  }

  if (!session)
    return (
      <main id="main" className="container section">
        <h1 className="workspace-title">ワークスペース</h1>
        {error ? (
          <>
            <p className="app-error" role="alert">
              読み込めませんでした：{error}
            </p>
            <button
              type="button"
              onClick={() =>
                loadSession().catch((caught) => setError(errorCode(caught)))
              }
            >
              再試行
            </button>
          </>
        ) : (
          <p role="status">ログイン状態を確認しています…</p>
        )}
      </main>
    );
  if (!session.identity || resetMode)
    return (
      <main id="main" className="container section">
        <AuthPanel
          authMode={session.authMode}
          googleEnabled={session.googleEnabled}
          localDemo={session.localDemo}
          onAuthenticated={async () => {
            await loadSession();
            setResetMode(false);
          }}
          onPasswordReset={() => {
            newConversation();
            setConversations([]);
            setModels([]);
            setSession((current) =>
              current ? { ...current, identity: null } : current,
            );
            setResetMode(false);
          }}
        />
      </main>
    );

  return (
    <main id="main" className="container workspace">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1 className="workspace-title">考えることから、はじめよう。</h1>
        </div>
        <div className="account-menu">
          <span>{session.identity.name || session.identity.email}</span>
          <button
            type="button"
            className="secondary"
            disabled={sending}
            onClick={logout}
          >
            ログアウト
          </button>
        </div>
      </div>
      {error && (
        <p className="app-error" role="alert">
          処理できませんでした：{error}
        </p>
      )}
      {notice && (
        <p className="app-notice" role="status">
          {notice}
        </p>
      )}
      <div className="chat-layout">
        <aside className="conversation-sidebar" aria-label="会話履歴">
          <button
            type="button"
            className="full-width"
            disabled={sending}
            onClick={newConversation}
          >
            ＋ 新しい会話
          </button>
          <h2>これまでの会話</h2>
          {!conversations.length && (
            <p className="app-hint">会話を始めると、ここに履歴が残ります。</p>
          )}
          <ul>
            {conversations.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={
                    selected === item.id
                      ? "conversation-link selected"
                      : "conversation-link"
                  }
                  aria-current={selected === item.id ? "true" : undefined}
                  disabled={sending}
                  onClick={() => {
                    setSelected(item.id);
                    setSources([]);
                    setError("");
                    setNotice("");
                  }}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="chat-main" aria-label="AIチャット">
          <div className="chat-toolbar">
            <label>
              モデル
              <select
                value={modelId}
                disabled={sending}
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="" disabled>
                  利用するモデルを選択
                </option>
                {models.map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    disabled={!model.available}
                  >
                    {model.label}
                    {model.available ? "" : "（未設定）"}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <button
                type="button"
                className="link-button"
                disabled={sending || loadingHistory}
                onClick={() => setRevision((value) => value + 1)}
              >
                履歴を更新
              </button>
            )}
            {selected && (
              <button
                type="button"
                className="link-button danger"
                disabled={sending || loadingHistory}
                onClick={removeConversation}
              >
                会話を削除
              </button>
            )}
          </div>
          {modelId === "local/demo" && (
            <p className="demo-label">
              AI未使用 · 動作確認用の固定応答です。外部へ送信しません。
            </p>
          )}
          {!modelId && (
            <p className="app-notice">
              利用できるモデルがありません。管理者が接続先を設定すると選択できます。
            </p>
          )}
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
                      <summary>
                        参照した資料（{message.sources.length}件）
                      </summary>
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
                  ) && (
                    <p className="app-hint">状態：{safeCode(message.status)}</p>
                  )}
                </article>
              ))
            ) : (
              <div className="chat-empty">
                <span aria-hidden="true">✳</span>
                <h2>
                  {currentConversation?.title ?? "いま、何を進めましょう？"}
                </h2>
                <p>
                  アイデアの整理、文章の下書き、仕事の相談。
                  <br />
                  下の入力欄から会話を始められます。
                </p>
              </div>
            )}
            <div ref={end} />
          </div>
          {sources.length > 0 && (
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
          )}
          <form onSubmit={send} className="chat-composer">
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
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="composer-actions">
              <div className="feature-toggles">
                {session.features.rag && (
                  <label>
                    <input
                      type="checkbox"
                      checked={useRag}
                      disabled={sending}
                      onChange={(event) => setUseRag(event.target.checked)}
                    />
                    資料を参照
                  </label>
                )}
                {session.features.agent && (
                  <label>
                    <input
                      type="checkbox"
                      checked={useAgent}
                      disabled={sending}
                      onChange={(event) => setUseAgent(event.target.checked)}
                    />
                    ツールを使用
                  </label>
                )}
              </div>
              {sending ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => controller.current?.abort()}
                >
                  応答を中断
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim() || !modelId || loadingHistory}
                >
                  送信する →
                </button>
              )}
            </div>
            <p className="app-hint">
              AIの回答は誤ることがあります。重要な内容は確認してください。
            </p>
          </form>
        </section>
      </div>
      <ExtensionsPanel
        features={session.features}
        models={models}
        modelId={modelId}
        revision={extensionVersion}
      />
    </main>
  );
}
