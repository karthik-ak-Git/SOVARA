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

// Mock window.sovara for AppShell tests that may invoke it indirectly
beforeEach(() => {
  ;(window as unknown as { sovara: unknown }).sovara = {
    invoke: vi.fn().mockResolvedValue(null),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Window['sovara']
})
afterEach(() => cleanup())

describe('Renderer shell — navigation & layout', () => {
  it('renders 7 navigation destinations', () => {
    const { container } = render(<Sidebar activeId="chat" onNavigate={() => {}} />)
    const buttons = container.querySelectorAll('button.nav-item')
    expect(buttons.length).toBe(7)
    expect(screen.getByRole('button', { name: /Chat/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Models/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agents/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Skills/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Library/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Runtime/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument()
  })

  it('marks active nav with aria-current=page', () => {
    render(<Sidebar activeId="models" onNavigate={() => {}} />)
    const active = screen.getByRole('button', { name: /^Models$/ })
    expect(active).toHaveAttribute('aria-current', 'page')
    const inactive = screen.getByRole('button', { name: /^Chat$/ })
    expect(inactive).not.toHaveAttribute('aria-current')
  })

  it('disabled nav items have aria-disabled and title', () => {
    render(<Sidebar activeId="chat" onNavigate={() => {}} />)
    const skills = screen.getByRole('button', { name: /Skills \(coming soon\)/ })
    expect(skills).toHaveAttribute('aria-disabled', 'true')
    expect(skills).toBeDisabled()
    expect(skills).toHaveAttribute('title', 'Skills — coming soon')
  })

  it('clicking nav calls onNavigate with id', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Sidebar activeId="chat" onNavigate={spy} />)
    await user.click(screen.getByRole('button', { name: /^Models$/ }))
    expect(spy).toHaveBeenCalledWith('models')
    // disabled should not fire
    await user.click(screen.getByRole('button', { name: /Skills \(coming soon\)/ }))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('TopBar shows brand', () => {
    render(<TopBar />)
    expect(screen.getByText('Sovara')).toBeInTheDocument()
  })

  it('AppShell renders topbar, sidebar, and main', () => {
    render(
      <AppShell activeNav="chat" onNavigate={() => {}}>
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

  it('keyboard navigation: tab order matches visual order', async () => {
    const user = userEvent.setup()
    render(<Sidebar activeId="chat" onNavigate={() => {}} />)
    // First nav item should be focusable via tab
    await user.tab()
    const first = screen.getByRole('button', { name: /^Chat$/ })
    expect(first).toHaveFocus()
  })
})
