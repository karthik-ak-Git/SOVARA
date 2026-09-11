import { useState, useEffect, useCallback, type ReactElement } from 'react'
import {
  Link2,
  RefreshCw,
  Plus,
  Trash2,
  FolderOpen,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Search,
  Activity,
  Server,
  Download,
} from 'lucide-react'
import {
  listMcpServers,
  addMcpServer,
  installMcpFromUrl,
  openMcpFolder,
  removeMcpServer,
  toggleMcpServer,
  probeMcpServer,
  type McpServerView,
} from '../../lib/ipc'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'

interface ConnectionsPageProps {
  onBack?: () => void
}

export function ConnectionsPage({ onBack: _onBack }: ConnectionsPageProps): ReactElement {
  const [servers, setServers] = useState<McpServerView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [probingId, setProbingId] = useState<string | null>(null)

  // Modal / Add state
  const [showAddModal, setShowAddModal] = useState(false)
  const [installUrl, setInstallUrl] = useState('')
  const [customName, setCustomName] = useState('')
  const [customCommand, setCustomCommand] = useState('')
  const [customEndpoint, setCustomEndpoint] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [actionBusy, setActionBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const list = await listMcpServers()
      setServers(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleToggle = useCallback(async (id: string, current: boolean): Promise<void> => {
    try {
      const updated = await toggleMcpServer(id, !current)
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const handleProbe = useCallback(async (id: string): Promise<void> => {
    setProbingId(id)
    try {
      const updated = await probeMcpServer(id)
      setServers((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProbingId(null)
    }
  }, [])

  const handleDelete = useCallback(async (id: string): Promise<void> => {
    try {
      await removeMcpServer(id)
      setServers((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    try {
      await openMcpFolder()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const handleInstallUrl = useCallback(async (): Promise<void> => {
    if (!installUrl.trim()) return
    setActionBusy(true)
    try {
      await installMcpFromUrl(installUrl.trim())
      setInstallUrl('')
      setShowAddModal(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }, [installUrl, reload])

  const handleAddManual = useCallback(async (): Promise<void> => {
    if (!customName.trim()) return
    setActionBusy(true)
    try {
      await addMcpServer({
        name: customName.trim(),
        transport,
        command: transport === 'stdio' ? customCommand.trim() || undefined : undefined,
        endpoint: transport === 'http' ? customEndpoint.trim() || undefined : undefined,
      })
      setCustomName('')
      setCustomCommand('')
      setCustomEndpoint('')
      setShowAddModal(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }, [customName, transport, customCommand, customEndpoint, reload])

  const filteredServers = servers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.command && s.command.toLowerCase().includes(search.toLowerCase())) ||
    (s.endpoint && s.endpoint.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="connections-page" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link2 size={20} className="text-primary" />
            Connections &amp; MCP Servers
          </h1>
          <p className="muted small" style={{ marginTop: '4px' }}>
            Model Context Protocol (MCP) integrations allowing your local AI to safely query local databases, filesystem, and tools.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <Button onClick={() => void handleOpenFolder()} aria-label="Open MCP Folder">
            <FolderOpen size={14} /> Open MCP Folder
          </Button>
          <Button onClick={() => void reload()} disabled={loading} aria-label="Refresh MCP servers">
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </Button>
          <Button variant="primary" onClick={() => setShowAddModal(true)} aria-label="Add MCP connection">
            <Plus size={14} /> Add Connection
          </Button>
        </div>
      </div>

      {error ? (
        <div className="chat-error" role="alert" style={{ marginBottom: '16px' }}>
          <span>{error}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--muted)' }} />
        <input
          type="search"
          className="input"
          placeholder="Search MCP servers & tools..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: '36px', width: '100%' }}
          aria-label="Filter MCP servers"
        />
      </div>

      {/* Servers List */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <Server size={16} />
            <span>Configured MCP Servers</span>
          </div>
          <div className="panel-hint muted small">
            {servers.filter((s) => s.enabled).length} active / {servers.length} configured
          </div>
        </div>

        {loading ? (
          <p className="muted small">Checking MCP server connections...</p>
        ) : filteredServers.length === 0 ? (
          <EmptyState
            title="No MCP connections found"
            description="Install MCP tools from GitHub (e.g. SQLite, Brave Search, Filesystem) or add a local stdio command."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            {filteredServers.map((server) => {
              const isProbing = probingId === server.id
              const isConnected = server.status === 'connected'
              return (
                <div
                  key={server.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px',
                    background: 'var(--panel-2)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-soft)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px' }}>{server.name}</strong>
                      <span className={`badge ${isConnected ? 'badge--success' : server.status === 'error' ? 'badge--warn' : 'badge--info'}`}>
                        {server.status ?? (server.enabled ? 'configured' : 'disabled')}
                      </span>
                      <span className="badge badge--neutral" style={{ fontSize: '10px' }}>
                        {server.transport}
                      </span>
                    </div>

                    <div className="muted small" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {server.transport === 'stdio' ? server.command ?? 'stdio' : server.endpoint ?? 'http'}
                    </div>

                    {server.lastError ? (
                      <div className="text-danger small" style={{ marginTop: '2px', fontSize: '11px' }}>
                        {server.lastError}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Button
                      onClick={() => void handleProbe(server.id)}
                      disabled={isProbing}
                      aria-label={`Test connection to ${server.name}`}
                    >
                      <Activity size={13} className={isProbing ? 'spin' : ''} /> Test
                    </Button>
                    <Button
                      variant={server.enabled ? 'primary' : 'ghost'}
                      onClick={() => void handleToggle(server.id, server.enabled)}
                      aria-label={`Toggle ${server.name}`}
                    >
                      {server.enabled ? 'Enabled' : 'Disabled'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void handleDelete(server.id)}
                      aria-label={`Remove ${server.name}`}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Add Modal */}
      {showAddModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          role="dialog"
          aria-label="Add MCP Server"
        >
          <div
            style={{
              background: 'var(--panel)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              maxWidth: '520px',
              width: '90%',
              boxShadow: 'var(--shadow-panel)',
              border: '1px solid var(--border)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Connect MCP Server</h2>
            <p className="muted small" style={{ marginTop: '4px', marginBottom: '16px' }}>
              Connect via GitHub repository URL or manually configure a stdio / HTTP server.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 500, fontSize: '12px', marginBottom: '4px' }}>
                One-Click Install from GitHub URL
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="url"
                  className="input"
                  placeholder="https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite"
                  value={installUrl}
                  onChange={(e) => setInstallUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button variant="primary" onClick={() => void handleInstallUrl()} disabled={actionBusy || !installUrl.trim()}>
                  <Download size={13} /> Install
                </Button>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: '16px', marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 500, fontSize: '12px', marginBottom: '4px' }}>
                Or Add Custom Server
              </label>
              <input
                type="text"
                className="input"
                placeholder="Server Name (e.g. SQLite Local DB)"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                style={{ width: '100%', marginBottom: '8px' }}
              />

              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <Button
                  variant={transport === 'stdio' ? 'primary' : 'ghost'}
                  onClick={() => setTransport('stdio')}
                  type="button"
                >
                  stdio (command)
                </Button>
                <Button
                  variant={transport === 'http' ? 'primary' : 'ghost'}
                  onClick={() => setTransport('http')}
                  type="button"
                >
                  HTTP endpoint
                </Button>
              </div>

              {transport === 'stdio' ? (
                <input
                  type="text"
                  className="input"
                  placeholder="Command: npx -y @modelcontextprotocol/server-filesystem D:/data"
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  style={{ width: '100%' }}
                />
              ) : (
                <input
                  type="url"
                  className="input"
                  placeholder="Endpoint: http://127.0.0.1:8000/sse"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                  style={{ width: '100%' }}
                />
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setShowAddModal(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => void handleAddManual()}
                disabled={actionBusy || !customName.trim()}
              >
                Add Server
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
