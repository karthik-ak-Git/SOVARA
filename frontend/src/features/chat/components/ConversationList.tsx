import type { Conversation } from "../types";

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
}: ConversationListProps): JSX.Element {
  if (conversations.length === 0) {
    return <p className="sv-convo-empty">No conversations yet.</p>;
  }
  return (
    <ul className="sv-convo-list" aria-label="Conversations">
      {conversations.map((c) => (
        <li key={c.id} className={c.id === activeId ? "sv-convo-active" : ""}>
          <button
            type="button"
            className="sv-convo-title"
            onClick={() => onSelect(c.id)}
            title={c.title}
          >
            {c.title}
          </button>
          <button
            type="button"
            className="sv-convo-del"
            onClick={() => onDelete(c.id)}
            aria-label={`Delete conversation ${c.title}`}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
