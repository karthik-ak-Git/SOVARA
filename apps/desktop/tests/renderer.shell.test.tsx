/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../src/renderer/src/components/layout/Sidebar'
import { TopBar } from '../src/renderer/src/components/layout/TopBar'
import { AppShell } from '../src/renderer/src/components/layout/AppShell'
import { Button } from '../src/renderer/src/components/ui/Button'
import { Card } from '../src/renderer/src/components/ui/Card'
import { EmptyState } from '../src/renderer/src/components/ui/EmptyState'
import { mockApi } from './helpers/http'

// Shell components are prop-driven; stub the internal API so any incidental
// mount-time call resolves instead of hitting the network.
beforeEach(() => {
  mockApi({})
})
afterEach(() => cleanup())

describe('Renderer shell — navigation & layout', () => {
  it('renders sidebar with Projects, Chats, and Settings', () => {
    render(
      <Sidebar
        activeId="chat"
        onNavigate={() => {}}
        projects={[]}
        recentChats={[]}
      />
    )
    expect(screen.getByText('Projects')).toBeInTheDocument()
    // Desktop labels the chat section "Conversation History" (quick nav);
    // "Recent Conversations" header only renders when recentChats is non-empty.
    expect(screen.getByText('Conversation History')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('renders New Project and New Chat action buttons', () => {
    render(
      <Sidebar
        activeId="chat"
        onNavigate={() => {}}
        projects={[]}
        recentChats={[]}
      />
    )
    expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument()
    // Desktop CTA reads "New Conversation", not "New Chat".
    expect(screen.getByRole('button', { name: /New Conversation/ })).toBeInTheDocument()
  })

  it('marks settings as active nav with aria-current=page', () => {
    render(
      <Sidebar
        activeId="settings"
        onNavigate={() => {}}
        projects={[]}
        recentChats={[]}
      />
    )
    const settings = screen.getByRole('button', { name: /Settings/ })
    expect(settings).toHaveAttribute('aria-current', 'page')
  })

  it('clicking New Chat calls onNewChat', async () => {
    const user = userEvent.setup()
    const onNewChat = vi.fn()
    render(
      <Sidebar
        activeId="chat"
        onNavigate={() => {}}
        projects={[]}
        recentChats={[]}
        onNewChat={onNewChat}
      />
    )
    await user.click(screen.getByRole('button', { name: /New Conversation/ }))
    expect(onNewChat).toHaveBeenCalledOnce()
  })

  it('clicking New Project calls onNewProject', async () => {
    const user = userEvent.setup()
    const onNewProject = vi.fn()
    render(
      <Sidebar
        activeId="chat"
        onNavigate={() => {}}
        projects={[]}
        recentChats={[]}
        onNewProject={onNewProject}
      />
    )
    await user.click(screen.getByRole('button', { name: /New Project/ }))
    expect(onNewProject).toHaveBeenCalledOnce()
  })

  it('renders project names and calls onSelectProject', async () => {
    const user = userEvent.setup()
    const onSelectProject = vi.fn()
    render(
      <Sidebar
        activeId="chat"
        onNavigate={() => {}}
        projects={[{ id: 'p1', name: 'My App', sessions: [] }]}
        selectedProjectId={null}
        onSelectProject={onSelectProject}
        recentChats={[]}
      />
    )
    // Desktop renders the project name as a clickable row (no
    // "Open project …" button); clicking the row selects the project.
    const projName = screen.getByText('My App')
    expect(projName).toBeInTheDocument()
    await user.click(projName)
    expect(onSelectProject).toHaveBeenCalledWith('p1')
  })

  it('renders per-project + button and calls onNewProjectChat', async () => {
    const user = userEvent.setup()
    const onNewProjectChat = vi.fn()
    render(
      <Sidebar
        activeId="chat"
        onNavigate={() => {}}
        projects={[{ id: 'p1', name: 'My App', sessions: [] }]}
        onNewProjectChat={onNewProjectChat}
        recentChats={[]}
      />
    )
    const addBtn = screen.getByRole('button', { name: 'New chat in My App' })
    await user.click(addBtn)
    expect(onNewProjectChat).toHaveBeenCalledWith('p1')
  })

  // NOTE (desktop-only): the desktop ChatRow has no rename/delete options
  // menu — onRenameChat/onDeleteChat props are accepted but never invoked
  // (only Pin/Archive exist). The two web-era rename/delete tests were
  // dropped per product decision instead of faked against Pin/Archive.

  it('renders recent chat titles and calls onSelectChat', async () => {
    const user = userEvent.setup()
    const onSelectChat = vi.fn()
    render(
      <Sidebar
        activeId="chat"
        onNavigate={() => {}}
        projects={[]}
        recentChats={[{ id: 'c1', title: 'Hello World' }]}
        selectedChatId={null}
        onSelectChat={onSelectChat}
      />
    )
    const chatItem = screen.getByText('Hello World')
    expect(chatItem).toBeInTheDocument()
    await user.click(chatItem.closest('button')!)
    expect(onSelectChat).toHaveBeenCalledWith('c1')
  })

  it('TopBar shows tabs and window controls', async () => {
    const user = userEvent.setup()
    const onCloseChat = vi.fn()
    // Desktop only renders the tab close button when >1 chat exists.
    render(<TopBar chats={[{ id: 'c1', title: 'Hello' }, { id: 'c2', title: 'World' }]} selectedChatId="c1" onCloseChat={onCloseChat} />)
    expect(screen.getByRole('tab', { name: /Hello/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /New tab/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Sovara Session/ })).not.toBeInTheDocument()
    // Browser context (no preload bridge): native controls stay hidden.
    expect(screen.queryByRole('button', { name: /Minimize/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close Hello' }))
    expect(onCloseChat).toHaveBeenCalledWith('c1')
    cleanup()

    // Electron shell (preload bridge present): native Min/Max/Close render.
    // Detection is module-level, so the bridge must exist before a fresh
    // import of the module.
    ;(window as unknown as Record<string, unknown>).sovara = { invoke: vi.fn() }
    try {
      vi.resetModules()
      const { TopBar: ShellTopBar } = await import('../src/renderer/src/components/layout/TopBar')
      render(<ShellTopBar chats={[{ id: 'c1', title: 'Hello' }]} selectedChatId="c1" />)
      expect(screen.getByRole('button', { name: /Minimize/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Maximize/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    } finally {
      delete (window as unknown as Record<string, unknown>).sovara
    }
  })

  it('AppShell renders topbar, sidebar, and main', () => {
    render(
      <AppShell
        activeNav="chat"
        onNavigate={() => {}}
        projects={[]}
        recentChats={[]}
      >
        <div>content</div>
      </AppShell>
    )
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByLabelText('Primary navigation')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('Button has accessible name and disabled state', async () => {
    const spy = vi.fn()
    render(<Button onClick={spy}>Click me</Button>)
    const btn = screen.getByRole('button', { name: 'Click me' })
    expect(btn).toBeEnabled()
    await userEvent.setup().click(btn)
    expect(spy).toHaveBeenCalledOnce()
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled()
  })

  it('Card renders children and EmptyState', () => {
    render(
      <Card>
        <EmptyState title="Empty" description="No data" />
      </Card>
    )
    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.getByText('No data')).toBeInTheDocument()
  })
})
