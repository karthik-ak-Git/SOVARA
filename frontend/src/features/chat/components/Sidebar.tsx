import type { Conversation } from "../types";
import { ConversationList } from "./ConversationList";
import { StatusIndicator } from "./StatusIndicator";

interface SidebarProps {
  collapsed: boolean;
  conversations: Conversation[];
  activeId: string | null;
  modelId: string | null;
  modelAvailable: boolean;
  localOnly: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar({
  collapsed,
  conversations,
  activeId,
  modelId,
  modelAvailable,
  localOnly,
  onToggle,
  onNewChat,
  onSelect,
  onDelete,
}: SidebarProps): JSX.Element {
  if (collapsed) {
    return (
      <aside className="sv-sidebar sv-collapsed" aria-label="Sidebar">
        <button
          type="button"
          className="sv-icon-btn"
          onClick={onToggle}
          aria-label="Expand sidebar"
        >
          ☰
        </button>
        <button
          type="button"
          className="sv-icon-btn"
          onClick={onNewChat}
          aria-label="New chat"
        >
          ＋
        </button>
      </aside>
    );
  }
  return (
    <aside className="sv-sidebar" aria-label="Sidebar">
      <div className="sv-brand">
        <div className="sv-brand-mark" aria-hidden="true">
          S
        </div>
        <span className="sv-brand-name">SOVARA</span>
        <button
          type="button"
          className="sv-icon-btn"
          onClick={onToggle}
          aria-label="Collapse sidebar"
        >
          ☰
        </button>
      </div>
      <button type="button" className="sv-newchat" onClick={onNewChat}>
        ＋ New chat
      </button>
      <div className="sv-convo-scroll">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      </div>
      <div className="sv-sidebar-foot">
        <StatusIndicator
          modelId={modelId}
          available={modelAvailable}
          localOnly={localOnly}
        />
      </div>
    </aside>
  );
}
