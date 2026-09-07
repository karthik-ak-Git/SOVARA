import { PanelLeftOpen, PanelLeftClose, Minus, Square, X, MessageSquare } from 'lucide-react'
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
}

export function TopBar({ activeTab = 'session', onTabSelect, sidebarOpen = true, onToggleSidebar = () => {}, chats = [], selectedChatId = null, onSelectChat }: Props): React.JSX.Element {
  return (
    <header className="topbar" role="banner">
      <div className="topbar-drag-region" />
      <div className="topbar-left">
        <button type="button" className="topbar-icon-btn" aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} aria-pressed={sidebarOpen} onClick={onToggleSidebar}>
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
            <button
              key={chat.id}
              type="button"
              role="tab"
              id={`tab-${chat.id}`}
              className={`topbar-tab ${selectedChatId === chat.id ? 'active' : ''}`}
              aria-selected={selectedChatId === chat.id}
              aria-controls="main-content"
              onClick={() => {
                onSelectChat?.(chat.id)
                onTabSelect?.(chat.id)
              }}
            >
              <MessageSquare size={14} className="topbar-tab-icon" aria-hidden />
              <span>{chat.title}</span>
            </button>
          ))
        )}
      </div>

      <div className="topbar-window-controls">
        <button type="button" className="topbar-win-btn" aria-label="Minimize" title="Minimize" onClick={minimizeWindow}>
          <Minus size={14} aria-hidden />
        </button>
        <button type="button" className="topbar-win-btn" aria-label="Maximize" title="Maximize" onClick={maximizeWindow}>
          <Square size={12} aria-hidden />
        </button>
        <button type="button" className="topbar-win-btn close" aria-label="Close" title="Close" onClick={closeWindow}>
          <X size={14} aria-hidden />
        </button>
      </div>
    </header>
  )
}
