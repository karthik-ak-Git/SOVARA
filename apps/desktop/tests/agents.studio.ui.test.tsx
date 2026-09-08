/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentsPage } from '../src/renderer/src/features/agents/AgentsPage'

beforeEach(() => {
  ;(window as unknown as { sovara: unknown }).sovara = {
    invoke: async (channel: string) => {
      if (channel === 'mcp:list') return []
      if (channel === 'mcp:getDir') return { path: 'C:\\\\Users\\\\Test\\\\mcp', exists: true }
      if (channel === 'mcp:openFolder') return { ok: true, path: 'C:\\\\Users\\\\Test\\\\mcp' }
      if (channel === 'mcp:installFromUrl') return { server: { id: 'test', name: 'test', provider: 'Test', transport: 'stdio', command: 'npx -y test', enabled: true, createdAt: Date.now(), status: 'connected' }, steps: [], detectedCommand: 'npx -y test', localPath: 'C:\\\\mcp\\\\test' }
      return null
    },
    on: () => () => {},
  } as unknown as Window['sovara']
})
afterEach(() => cleanup())

describe('Agent Studio — greenfield command center', () => {
  it('renders left navigator with required groups and Create New Agent', () => {
    render(<AgentsPage />)
    expect(screen.getByTestId('agent-studio')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create new agent/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /All Agents/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Favorites/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Recent/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Team Agents/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Templates/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Archived/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search agents/)).toBeInTheDocument()
  })

  it('renders central overview dashboard with metrics and quick actions', () => {
    render(<AgentsPage />)
    // Metrics
    expect(screen.getByText(/Total runs/)).toBeInTheDocument()
    expect(screen.getByText(/Avg latency/)).toBeInTheDocument()
    expect(screen.getAllByText(/Knowledge/).length).toBeGreaterThan(0)
    expect(screen.getByText(/MCP health/)).toBeInTheDocument()
    // Quick actions
    expect(screen.getByText(/Edit prompt/)).toBeInTheDocument()
    expect(screen.getByText(/Add knowledge/)).toBeInTheDocument()
    expect(screen.getByText(/Run test/)).toBeInTheDocument()
    expect(screen.getAllByText(/Publish/).length).toBeGreaterThan(0)
    // System-aware recommendation
    expect(screen.getByText(/System-aware recommendation/)).toBeInTheDocument()
  })

  it('exposes all lifecycle workspaces in the workspace bar', () => {
    render(<AgentsPage />)
    for (const label of ['Overview', 'Instructions', 'Knowledge', 'Skills', 'Connected Apps', 'Tools', 'Memory', 'Workflows', 'Testing', 'Analytics', 'Versions', 'Permissions', 'Settings']) {
      expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(screen.getByText('MCP only')).toBeInTheDocument()
  })

  it('switches dynamic workspace: Knowledge file explorer', async () => {
    const user = userEvent.setup()
    render(<AgentsPage />)
    await user.click(screen.getByRole('tab', { name: /Knowledge/ }))
    expect(screen.getByText(/Knowledge explorer/)).toBeInTheDocument()
    expect(screen.getByText(/RAG is project-scoped/)).toBeInTheDocument()
    expect(screen.getByText(/Drop files here/)).toBeInTheDocument()
  })

  it('switches dynamic workspace: prompt editing, skill cards, MCP, memory, workflow builder', async () => {
    const user = userEvent.setup()
    render(<AgentsPage />)
    await user.click(screen.getByRole('tab', { name: /Instructions/ }))
    expect(screen.getByText(/Prompt editor/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Agent instructions/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Skills/ }))
    expect(screen.getByText('Deep Research')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Connected Apps/ }))
    expect(screen.getAllByText(/MCP only/).length).toBeGreaterThan(0)
    expect(await screen.findByText(/Tool manifest/, {}, { timeout: 2000 })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Memory/ }))
    expect(screen.getByText(/Memory inspector/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Workflows/ }))
    expect(screen.getByText(/Workflow builder/)).toBeInTheDocument()
    expect(screen.getAllByText(/Weekly research digest/).length).toBeGreaterThan(0)
  })

  it('switches dynamic workspace: testing playground, analytics dashboards, versions timeline, visual permissions', async () => {
    const user = userEvent.setup()
    render(<AgentsPage />)
    await user.click(screen.getByRole('tab', { name: /^Testing/ }))
    expect(screen.getByText(/Playground/)).toBeInTheDocument()
    expect(screen.getByText(/Evaluation/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Analytics/ }))
    expect(screen.getByText(/Recent runs/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Versions/ }))
    expect(screen.getByText(/Versions timeline/)).toBeInTheDocument()
    expect(screen.getAllByText(/v12/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('tab', { name: /Permissions/ }))
    expect(screen.getByText(/Visual permissions/)).toBeInTheDocument()
    expect(screen.getAllByText(/Knowledge/).length).toBeGreaterThan(0)
  })

  it('has collapsible right intelligence panel with live status, active tools, resumable download, recent activity', async () => {
    const user = userEvent.setup()
    render(<AgentsPage />)
    expect(screen.getByLabelText(/Intelligence panel/)).toBeInTheDocument()
    expect(screen.getByText(/Live status/)).toBeInTheDocument()
    expect(screen.getByText(/Active tools/)).toBeInTheDocument()
    expect(screen.getByText(/Resumable download/)).toBeInTheDocument()
    expect(screen.getByText(/62%/)).toBeInTheDocument()
    expect(screen.getByText(/Recent activity/)).toBeInTheDocument()

    // Pause/Resume toggle
    const pause = screen.getByRole('button', { name: /Pause/ })
    await user.click(pause)
    expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument()

    // Collapse via header toggle (there are two collapse buttons — pick the header one)
    const collapse = screen.getAllByRole('button', { name: /Collapse intelligence panel/ })[0]
    await user.click(collapse)
    expect(screen.getByRole('button', { name: /Show intelligence panel/ })).toBeInTheDocument()
    expect(screen.getByTestId('agent-studio')).toHaveClass('as-shell--collapsed-right')

    // Expand via FAB
    await user.click(screen.getByRole('button', { name: /Show intelligence panel/ }))
    expect(screen.getByLabelText(/Intelligence panel/)).toBeVisible()
  })

  it('does not render old .agents-workspace layout (greenfield guarantee)', () => {
    render(<AgentsPage />)
    expect(document.querySelector('.agents-workspace')).toBeNull()
    expect(document.querySelector('.agents-nav')).toBeNull()
    expect(document.querySelector('.as-shell')).toBeInTheDocument()
    expect(document.querySelector('.as-nav')).toBeInTheDocument()
    expect(document.querySelector('.as-intel')).toBeInTheDocument()
  })
})
