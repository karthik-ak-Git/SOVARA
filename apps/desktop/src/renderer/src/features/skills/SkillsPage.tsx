import { useState, useEffect, useCallback, type ReactElement } from 'react'
import {
  Sparkles,
  RefreshCw,
  Plus,
  Trash2,
  FolderOpen,
  CheckCircle2,
  XCircle,
  Search,
  Code2,
  Layers,
} from 'lucide-react'
import {
  scanSkills,
  toggleSkillsSource,
  listBionicSkills,
  addBionicSkill,
  removeBionicSkill,
  listDetailedSkills,
  importSkillFromUrl,
  type SkillsSource,
  type BionicSkillView,
} from '../../lib/ipc'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'

interface SkillsPageProps {
  onBack?: () => void
}

export function SkillsPage({ onBack: _onBack }: SkillsPageProps): ReactElement {
  const [sources, setSources] = useState<SkillsSource[]>([])
  const [detailed, setDetailed] = useState<Array<{ name: string; path: string; skills: BionicSkillView[] }>>([])
  const [bionic, setBionic] = useState<BionicSkillView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // New skill form
  const [showAddModal, setShowAddModal] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillDesc, setNewSkillDesc] = useState('')
  const [newSkillContent, setNewSkillContent] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [src, b, det] = await Promise.all([
        scanSkills().catch(() => [] as SkillsSource[]),
        listBionicSkills().catch(() => [] as BionicSkillView[]),
        listDetailedSkills().catch(() => [] as Array<{ name: string; path: string; skills: BionicSkillView[] }>),
      ])
      setSources(src)
      setBionic(b)
      setDetailed(det)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleToggle = useCallback(async (name: string, current: boolean): Promise<void> => {
    try {
      await toggleSkillsSource(name, !current)
      setSources((prev) => prev.map((s) => (s.name === name ? { ...s, enabled: !current } : s)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const handleAddCustom = useCallback(async (): Promise<void> => {
    if (!newSkillName.trim() || !newSkillContent.trim()) return
    setActionBusy(true)
    try {
      await addBionicSkill({
        name: newSkillName.trim(),
        description: newSkillDesc.trim() || undefined,
        content: newSkillContent.trim(),
      })
      setNewSkillName('')
      setNewSkillDesc('')
      setNewSkillContent('')
      setShowAddModal(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }, [newSkillName, newSkillDesc, newSkillContent, reload])

  const handleImport = useCallback(async (): Promise<void> => {
    if (!importUrl.trim()) return
    setActionBusy(true)
    try {
      await importSkillFromUrl(importUrl.trim())
      setImportUrl('')
      setShowAddModal(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }, [importUrl, reload])

  const handleDeleteBionic = useCallback(async (id: string): Promise<void> => {
    try {
      await removeBionicSkill(id)
      setBionic((prev) => prev.filter((b) => b.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const filteredSources = sources.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) || s.path.toLowerCase().includes(search.toLowerCase())
  )

  const filteredBionic = bionic.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) || b.description.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="skills-page" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} className="text-primary" />
            Skills &amp; Capabilities
          </h1>
          <p className="muted small" style={{ marginTop: '4px' }}>
            Scanned from your local filesystem and custom curated skills. Loaded automatically by the local agent orchestrator.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <Button onClick={() => void reload()} disabled={loading} aria-label="Refresh skills">
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </Button>
          <Button variant="primary" onClick={() => setShowAddModal(true)} aria-label="Add custom skill">
            <Plus size={14} /> Add Skill
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

      {/* Search Bar */}
      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--muted)' }} />
        <input
          type="search"
          className="input"
          placeholder="Filter skills & sources..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: '36px', width: '100%' }}
          aria-label="Filter skills"
        />
      </div>

      {/* Sources Section */}
      <Card style={{ marginBottom: '24px' }}>
        <div className="panel-head">
          <div className="panel-title">
            <FolderOpen size={16} />
            <span>Local Skill Sources</span>
          </div>
          <div className="panel-hint muted small">
            {sources.filter((s) => s.enabled).length} active / {sources.length} detected
          </div>
        </div>

        {loading ? (
          <p className="muted small">Scanning local directories...</p>
        ) : filteredSources.length === 0 ? (
          <EmptyState
            title="No skill directories found"
            description="Sovora checks ~/.gemini/antigravity/skills, ~/.claude/skills, and .opencode/skills for skill definitions."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            {filteredSources.map((source) => (
              <div
                key={source.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px',
                  background: 'var(--panel-2)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-soft)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {source.name}
                    <span className="badge badge--info">{source.skillCount} skills</span>
                  </div>
                  <div className="muted small" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', marginTop: '2px' }}>
                    {source.path}
                  </div>
                </div>
                <Button
                  variant={source.enabled ? 'primary' : 'ghost'}
                  onClick={() => void handleToggle(source.name, source.enabled)}
                  aria-label={`Toggle ${source.name}`}
                >
                  {source.enabled ? (
                    <>
                      <CheckCircle2 size={14} /> Enabled
                    </>
                  ) : (
                    <>
                      <XCircle size={14} /> Disabled
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Detailed Discovered Skills */}
      {detailed.length > 0 ? (
        <Card style={{ marginBottom: '24px' }}>
          <div className="panel-head">
            <div className="panel-title">
              <Layers size={16} />
              <span>Discovered Skills by Source</span>
            </div>
            <div className="panel-hint muted small">Ready for local agent execution</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
            {detailed.map((group) => (
              <div key={group.name} style={{ borderBottom: '1px solid var(--border-soft)', paddingBottom: '12px' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px', color: 'var(--text)' }}>
                  📁 {group.name} ({group.skills.length} skills)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
                  {group.skills.map((sk) => (
                    <div
                      key={sk.id}
                      style={{
                        padding: '10px',
                        background: 'var(--panel-2)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-soft)',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '12px' }}>{sk.name}</div>
                      {sk.description ? (
                        <div className="muted small" style={{ fontSize: '11px', marginTop: '2px' }}>
                          {sk.description}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Custom Bionic Skills */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <Code2 size={16} />
            <span>Custom Curated Skills</span>
          </div>
          <div className="panel-hint muted small">{bionic.length} configured</div>
        </div>

        {filteredBionic.length === 0 ? (
          <EmptyState
            title="No custom skills created yet"
            description="Add custom skills or import existing skills from GitHub repositories to give your local agent specialized workflows."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            {filteredBionic.map((sk) => (
              <div
                key={sk.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px',
                  background: 'var(--panel-2)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-soft)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{sk.name}</div>
                  {sk.description ? <div className="muted small">{sk.description}</div> : null}
                </div>
                <Button variant="ghost" onClick={() => void handleDeleteBionic(sk.id)} aria-label={`Delete ${sk.name}`}>
                  <Trash2 size={14} /> Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add / Import Modal */}
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
          aria-label="Add or import skill"
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
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Add or Import Skill</h2>
            <p className="muted small" style={{ marginTop: '4px', marginBottom: '16px' }}>
              Import from a GitHub/web URL or define an inline skill prompt.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 500, fontSize: '12px', marginBottom: '4px' }}>
                Import from URL
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="url"
                  className="input"
                  placeholder="https://github.com/org/repo or skill raw URL"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button variant="primary" onClick={() => void handleImport()} disabled={actionBusy || !importUrl.trim()}>
                  Import
                </Button>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: '16px', marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 500, fontSize: '12px', marginBottom: '4px' }}>
                Or Create Custom Skill
              </label>
              <input
                type="text"
                className="input"
                placeholder="Skill Name (e.g. Git Commit Generator)"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                style={{ width: '100%', marginBottom: '8px' }}
              />
              <input
                type="text"
                className="input"
                placeholder="Brief description"
                value={newSkillDesc}
                onChange={(e) => setNewSkillDesc(e.target.value)}
                style={{ width: '100%', marginBottom: '8px' }}
              />
              <textarea
                className="input"
                placeholder="Instructions / skill markdown prompt..."
                rows={4}
                value={newSkillContent}
                onChange={(e) => setNewSkillContent(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setShowAddModal(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => void handleAddCustom()}
                disabled={actionBusy || !newSkillName.trim() || !newSkillContent.trim()}
              >
                Create Skill
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
