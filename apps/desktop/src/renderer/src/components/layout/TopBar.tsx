import { Grid3X3, Plus, Settings, Minus, Square, X } from 'lucide-react'

interface Props {
  appName?: string
  activeTab?: string
  onTabSelect?: (tabId: string) => void
}

export function TopBar({ appName = 'Sovara', activeTab = 'new-tab', onTabSelect }: Props): React.JSX.Element {
  return (
    <header className="topbar" role="banner">
      <div className="topbar-left">
        <button type="button" className="topbar-icon-btn" aria-label="Applications">
          <Grid3X3 size={16} aria-hidden />
        </button>
        <button type="button" className="topbar-icon-btn" aria-label="New">
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
          <Settings size={14} aria-hidden className="topbar-tab-icon" />
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
          <span>{appName} Session</span>
        </button>
      </div>

      <div className="topbar-window-controls">
        <button type="button" className="topbar-win-btn" aria-label="Minimize">
          <Minus size={14} aria-hidden />
        </button>
        <button type="button" className="topbar-win-btn" aria-label="Maximize">
          <Square size={12} aria-hidden />
        </button>
        <button type="button" className="topbar-win-btn close" aria-label="Close">
          <X size={14} aria-hidden />
        </button>
      </div>
    </header>
  )
}
