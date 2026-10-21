import type { Model } from "../api-client";

export function ChatToolbar({
  models,
  modelId,
  sending,
  loadingHistory,
  hasConversation,
  onModelChange,
  onRefresh,
  onDelete,
}: {
  models: Model[];
  modelId: string;
  sending: boolean;
  loadingHistory: boolean;
  hasConversation: boolean;
  onModelChange: (modelId: string) => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="chat-toolbar">
        <label>
          モデル
          <select
            value={modelId}
            disabled={sending}
            onChange={(event) => onModelChange(event.target.value)}
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
        {hasConversation && (
          <button
            type="button"
            className="link-button"
            disabled={sending || loadingHistory}
            onClick={onRefresh}
          >
            履歴を更新
          </button>
        )}
        {hasConversation && (
          <button
            type="button"
            className="link-button danger"
            disabled={sending || loadingHistory}
            onClick={onDelete}
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
    </>
  );
}
