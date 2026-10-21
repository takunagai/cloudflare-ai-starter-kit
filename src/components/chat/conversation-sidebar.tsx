import type { Conversation } from "./chat-stream";

export function ConversationSidebar({
  conversations,
  selected,
  sending,
  onNew,
  onSelect,
}: {
  conversations: Conversation[];
  selected: string | null;
  sending: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="conversation-sidebar" aria-label="会話履歴">
      <button
        type="button"
        className="full-width"
        disabled={sending}
        onClick={onNew}
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
              onClick={() => onSelect(item.id)}
            >
              {item.title}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
