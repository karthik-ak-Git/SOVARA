import {
  PanelLeftOpen,
  PanelLeftClose,
  Minus,
  Square,
  X,
  Plus,
  MessageSquare,
  Code2,
  Columns,
  Share2,
  Cpu,
} from 'lucide-react'
import { minimizeWindow, maximizeWindow, closeWindow } from '../../lib/ipc'

interface ChatTab {
  id: string
  title: string
}

interface Props {
  activeTab?: string
  onTabSelect?: (tabId: string) => void
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  chats?: ChatTab[]
  selectedChatId?: string | null
  onSelectChat?: (id: string) => void
  onCloseChat?: (id: string) => void
  onNewChat?: () => void
  activeModelName?: string
  activeModelContext?: string
  onToggleArtifacts?: () => void
  artifactsOpen?: boolean
  onToggleSplit?: () => void
  splitOpen?: boolean
  onShare?: () => void
  hardwareStatus?: string
}

export function TopBar({
  activeTab = 'session',
  onTabSelect,
  sidebarOpen = true,
  onToggleSidebar = () => {},
  chats = [],
  selectedChatId = null,
  onSelectChat,
  onCloseChat,
  onNewChat,
  activeModelName,
  activeModelContext,
  onToggleArtifacts,
  artifactsOpen = false,
  onToggleSplit,
  splitOpen = false,
  onShare,
  hardwareStatus,
}: Props): React.JSX.Element {
  return (
    <header className="topbar" role="banner">
      <div className="topbar-drag-region" />
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-icon-btn"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-pressed={sidebarOpen}
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? <PanelLeftClose size={16} aria-hidden /> : <PanelLeftOpen size={16} aria-hidden />}
        </button>
      </div>

      <div className="topbar-tabs" role="tablist" aria-label="Chats">
        {chats.length === 0 ? (
          <span className="topbar-tab active" role="tab" aria-selected>
            <MessageSquare size={14} className="topbar-tab-icon" aria-hidden />
            <span>New chat</span>
          </span>
        ) : (
          chats.map((chat) => (
            <span
              key={chat.id}
              role="tab"
              id={`tab-${chat.id}`}
              className={`topbar-tab ${selectedChatId === chat.id ? 'active' : ''}`}
              aria-selected={selectedChatId === chat.id}
              aria-controls="main-content"
            >
              <button
                type="button"
                className="topbar-tab-label"
                aria-label={`Open ${chat.title}`}
                onClick={() => {
                  onSelectChat?.(chat.id)
                  onTabSelect?.(chat.id)
                }}
              >
                <MessageSquare size={14} className="topbar-tab-icon" aria-hidden />
                <span>{chat.title}</span>
              </button>
              <button
                type="button"
                className="topbar-tab-close"
                aria-label={`Close ${chat.title}`}
                title={`Close ${chat.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseChat?.(chat.id)
                }}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))
        )}
        {onNewChat ? (
          <button
            type="button"
            className="topbar-icon-btn topbar-tab-add"
            onClick={onNewChat}
            title="New Chat Tab"
            aria-label="New Chat Tab"
          >
            <Plus size={14} />
          </button>
        ) : null}
      </div>

      {/* Top right controls */}
      <div className="topbar-right-actions">
        {activeModelName ? (
          <div className="topbar-model-chip" title={`Active Model: ${activeModelName}`}>
            <span className="status-dot" aria-hidden>●</span>
            <span className="topbar-model-name">{activeModelName}</span>
            {activeModelContext ? (
              <span className="topbar-model-ctx">{activeModelContext}</span>
            ) : null}
          </div>
        ) : null}

        {hardwareStatus ? (
          <div className="topbar-hw-chip" title="Hardware status">
            <Cpu size={12} />
            <span>{hardwareStatus}</span>
          </div>
        ) : null}

        {onToggleArtifacts ? (
          <button
            type="button"
            className={`topbar-tool-btn ${artifactsOpen ? 'active' : ''}`}
            onClick={onToggleArtifacts}
            title="Toggle Artifacts panel"
            aria-label="Toggle Artifacts panel"
            aria-pressed={artifactsOpen}
          >
            <Code2 size={14} />
            <span className="hidden-sm">Artifacts</span>
          </button>
        ) : null}

        {onToggleSplit ? (
          <button
            type="button"
            className={`topbar-tool-btn ${splitOpen ? 'active' : ''}`}
            onClick={onToggleSplit}
            title="Split view"
            aria-label="Split view"
            aria-pressed={splitOpen}
          >
            <Columns size={14} />
          </button>
        ) : null}

        {onShare ? (
          <button
            type="button"
            className="topbar-tool-btn"
            onClick={onShare}
            title="Export / Copy session transcript"
            aria-label="Export session"
          >
            <Share2 size={14} />
          </button>
        ) : null}
      </div>

      <div className="topbar-window-controls">
        <button
          type="button"
          className="topbar-win-btn"
          aria-label="Minimize"
          title="Minimize"
          onClick={minimizeWindow}
        >
          <Minus size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="topbar-win-btn"
          aria-label="Maximize"
          title="Maximize"
          onClick={maximizeWindow}
        >
          <Square size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="topbar-win-btn close"
          aria-label="Close"
          title="Close"
          onClick={closeWindow}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </header>
  )
}
