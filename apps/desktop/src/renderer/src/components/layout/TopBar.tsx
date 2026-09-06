import { Grid3X3, Plus, Minus, Square, X } from 'lucide-react'
import { minimizeWindow, maximizeWindow, closeWindow } from '../../lib/ipc'

interface Props {
  activeTab?: string
  onTabSelect?: (tabId: string) => void
  onNewSession?: () => void
}

export function TopBar({ activeTab = 'new-tab', onTabSelect, onNewSession }: Props): React.JSX.Element {
  return (
    <header className="topbar" role="banner">
      <div className="topbar-drag-region" />
      <div className="topbar-left">
        <button type="button" className="topbar-icon-btn" aria-label="Applications" title="Applications">
          <Grid3X3 size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="topbar-icon-btn"
          aria-label="New"
          title="New session"
          onClick={() => onNewSession?.()}
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>

      <div className="topbar-tabs" role="tablist" aria-label="Open tabs">
        <button
          type="button"
          role="tab"
          className={`topbar-tab ${activeTab === 'new-tab' ? 'active' : ''}`}
          aria-selected={activeTab === 'new-tab'}
          onClick={() => onTabSelect?.('new-tab')}
        >
          <span>New tab</span>
        </button>
        <button
          type="button"
          role="tab"
          className={`topbar-tab ${activeTab === 'session' ? 'active' : ''}`}
          aria-selected={activeTab === 'session'}
          onClick={() => onTabSelect?.('session')}
        >
          <span className="topbar-tab-icon" aria-hidden>◆</span>
          <span>Sovara Session</span>
        </button>
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
