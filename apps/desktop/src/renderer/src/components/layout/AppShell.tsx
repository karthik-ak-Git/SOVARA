import type { ReactNode } from 'react'
import { TopBar } from './TopBar'
import { Sidebar, type NavId } from './Sidebar'

interface Props {
  activeNav: NavId
  onNavigate: (id: NavId) => void
  children: ReactNode
  footer?: ReactNode
}

export function AppShell({ activeNav, onNavigate, children, footer }: Props): React.JSX.Element {
  return (
    <div className="app">
      <TopBar />
      <div className="layout">
        <Sidebar activeId={activeNav} onNavigate={onNavigate} footer={footer} />
        <main className="main" role="main" tabIndex={-1} id="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}
