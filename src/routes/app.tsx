import { createFileRoute } from "@tanstack/react-router";
import {
  type SubmitEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { ChatComposer, StreamSources } from "../components/chat/chat-composer";
import {
  type Conversation,
  consumeEvents,
  type Message,
  PRE_ACCEPTANCE_ERRORS,
  type Source,
} from "../components/chat/chat-stream";
import { ChatToolbar } from "../components/chat/chat-toolbar";
import { ConversationSidebar } from "../components/chat/conversation-sidebar";
import { MessageList } from "../components/chat/message-list";
import { RequestRecoveryCard } from "../components/chat/request-recovery-card";
import { ExtensionsPanel } from "../components/extensions-panel";
import {
  forgetRequest,
  pendingRequest,
  rememberRequest,
} from "../components/request-recovery";
import {
  failureMessage,
  type PendingRequest,
  type RequestReceipt,
} from "../lib/reliability";

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
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [receipt, setReceipt] = useState<RequestReceipt | null>(null);
  const [isCheckingRequest, setCheckingRequest] = useState(false);
  const [isRecoveryReady, setRecoveryReady] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const currentConversation = conversations.find(
    (item) => item.id === selected,
  );
  const identityId = resetMode ? undefined : session?.identity?.id;
  useEffect(() => {
    setRecoveryReady(false);
    if (!identityId) return;
    const restore = () => {
      try {
        setPending(pendingRequest(identityId));
        setReceipt(null);
        setRecoveryReady(true);
      } catch (caught) {
        setError(errorCode(caught));
      }
    };
    restore();
    window.addEventListener("storage", restore);
    return () => window.removeEventListener("storage", restore);
  }, [identityId]);

  async function reconcileRequest() {
    if (!pending || !identityId) return;
    setCheckingRequest(true);
    setError("");
    try {
      const result = await api<RequestReceipt>(
        `/api/chat/requests/${pending.requestId}`,
      );
      setReceipt(result);
      if (result.conversationId) {
        const history = await api<{ messages: Message[] }>(
          `/api/conversations/${result.conversationId}`,
        );
        setSelected(result.conversationId);
        setMessages(history.messages);
        setSources([]);
      }
      if (result.status === "complete") {
        forgetRequest(identityId, pending.requestId);
        setPending(null);
        setNotice(
          result.conversationId
            ? "保存済みの回答を復元しました。再生成していません。"
            : "要求の完了記録を確認しました。会話は削除済みです。再生成していません。",
        );
      }
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setCheckingRequest(false);
    }
  }

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
  async function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (
      !message ||
      controller.current ||
      sending ||
      !modelId ||
      loadingHistory ||
      !identityId ||
      !isRecoveryReady ||
      pending
    )
      return;
    try {
      const outstanding = pendingRequest(identityId);
      if (outstanding) {
        setPending(outstanding);
        return;
      }
    } catch (caught) {
      setError(errorCode(caught));
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setSending(true);
    setError("");
    setNotice("");
    setSources([]);
    let conversationId = selected;
    const assistantId = crypto.randomUUID();
    let finished = false;
    const requestId = crypto.randomUUID();
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
      // 送信前に要求IDだけを記録し、結果未確認のまま再送しない。
      const recovery = { requestId, conversationId };
      rememberRequest(identityId, recovery);
      setPending(recovery);
      setReceipt(null);
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
          requestId,
          modelId,
          message,
          ...(useRag && session?.features.rag ? { rag: true } : {}),
          ...(useAgent && session?.features.agent ? { agent: true } : {}),
        }),
      }).catch(() => {
        throw new ClientError("network_unconfirmed");
      });
      if (response.redirected || response.status === 401)
        throw new ClientError("authentication_required");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const code = responseError(data);
        if (PRE_ACCEPTANCE_ERRORS.includes(code)) {
          forgetRequest(identityId, requestId);
          setPending(null);
        }
        throw new ClientError(code);
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
        if (
          !response.headers.get("Content-Type")?.includes("text/event-stream")
        )
          throw new ClientError("unexpected_response");
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
      forgetRequest(identityId, requestId);
      setPending(null);
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
          {failureMessage(error)}
        </p>
      )}
      {notice && (
        <p className="app-notice" role="status">
          {notice}
        </p>
      )}
      {pending && !sending && (
        <RequestRecoveryCard
          pending={pending}
          receipt={receipt}
          isChecking={isCheckingRequest}
          onReconcile={() => void reconcileRequest()}
          onResume={() => {
            if (!identityId) return;
            try {
              forgetRequest(identityId, pending.requestId);
              setPending(null);
              setReceipt(null);
            } catch (caught) {
              setError(errorCode(caught));
            }
          }}
        />
      )}
      <div className="chat-layout">
        <ConversationSidebar
          conversations={conversations}
          selected={selected}
          sending={sending}
          onNew={newConversation}
          onSelect={(id) => {
            setSelected(id);
            setSources([]);
            setError("");
            setNotice("");
          }}
        />
        <section className="chat-main" aria-label="AIチャット">
          <ChatToolbar
            models={models}
            modelId={modelId}
            sending={sending}
            loadingHistory={loadingHistory}
            hasConversation={!!selected}
            onModelChange={setModelId}
            onRefresh={() => setRevision((value) => value + 1)}
            onDelete={removeConversation}
          />
          <MessageList
            messages={messages}
            loadingHistory={loadingHistory}
            sending={sending}
            emptyTitle={currentConversation?.title}
            endRef={end}
          />
          <StreamSources sources={sources} />
          <ChatComposer
            draft={draft}
            sending={sending}
            loadingHistory={loadingHistory}
            canSubmit={
              !!draft.trim() &&
              !!modelId &&
              !loadingHistory &&
              !pending &&
              isRecoveryReady
            }
            rag={
              session.features.rag
                ? { checked: useRag, onChange: setUseRag }
                : null
            }
            agent={
              session.features.agent
                ? { checked: useAgent, onChange: setUseAgent }
                : null
            }
            onDraftChange={setDraft}
            onSubmit={send}
            onAbort={() => controller.current?.abort()}
          />
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
