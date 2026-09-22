'use client'

import { useState, useEffect, useMemo, type ReactElement } from 'react'
import {
  Search,
  Filter,
  MoreVertical,
  Folder,
  FileText,
  Clock,
  Loader2,
  Calendar,
  Archive,
} from 'lucide-react'
import {
  listSessions,
  listArchivedSessions,
  listProjects,
  type SessionHeaderView,
  type ProjectView,
} from '@/lib/client/api'

interface ConversationHistoryPageProps {
  onSelectSession: (id: string) => void
  onNewSession?: () => void
}

interface EnrichedSession extends SessionHeaderView {
  projectName: string
  isArchived: boolean
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return 'now'
  const diffMs = Date.now() - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHours = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMin < 5) return 'now'
  if (diffHours < 1) return `${diffMin}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 30) return `${diffDays}d`
  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths}mo`
}

export function ConversationHistoryPage({
  onSelectSession,
  onNewSession,
}: ConversationHistoryPageProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSessions, setActiveSessions] = useState<SessionHeaderView[]>([])
  const [archivedSessions, setArchivedSessions] = useState<SessionHeaderView[]>([])
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'archived'>('all')
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    async function loadData() {
      try {
        const [active, archived, projs] = await Promise.all([
          listSessions().catch(() => []),
          listArchivedSessions().catch(() => []),
          listProjects().catch(() => []),
        ])
        if (mounted) {
          setActiveSessions(active)
          setArchivedSessions(archived)
          setProjects(projs)
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void loadData()
    return () => {
      mounted = false
    }
  }, [])

  const enrichedSessions: EnrichedSession[] = useMemo(() => {
    const projectMap = new Map<string, string>()
    projects.forEach((p) => projectMap.set(p.id, p.name))

    const activeList: EnrichedSession[] = activeSessions.map((s) => {
      let pName = 'SOVARA'
      if (s.projectId && projectMap.has(s.projectId)) {
        pName = projectMap.get(s.projectId)!
      } else if (!s.projectId || s.projectId === '__global__') {
        pName = 'SOVARA'
      } else {
        pName = 'Outside of Project'
      }
      return {
        ...s,
        projectName: pName,
        isArchived: false,
      }
    })

    const archivedList: EnrichedSession[] = archivedSessions.map((s) => {
      let pName = 'SOVARA'
      if (s.projectId && projectMap.has(s.projectId)) {
        pName = projectMap.get(s.projectId)!
      } else if (!s.projectId || s.projectId === '__global__') {
        pName = 'SOVARA'
      } else {
        pName = 'Outside of Project'
      }
      return {
        ...s,
        projectName: pName,
        isArchived: true,
      }
    })

    // Sort combined by updatedAt descending
    const combined = [...activeList, ...archivedList]
    combined.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    return combined
  }, [activeSessions, archivedSessions, projects])

  const filteredSessions = useMemo(() => {
    let result = enrichedSessions
    if (filterMode === 'active') {
      result = result.filter((s) => !s.isArchived)
    } else if (filterMode === 'archived') {
      result = result.filter((s) => s.isArchived)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q)
      )
    }
    return result
  }, [enrichedSessions, filterMode, searchQuery])

  return (
    <div
      className="conversation-history-page"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: '#ffffff',
        padding: '36px 24px',
        overflowY: 'auto',
        fontFamily: "'Manrope', ui-sans-system, sans-serif",
      }}
    >
      <div style={{ width: '100%', maxWidth: 720 }}>
        {/* Title */}
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: '#0f172a',
            margin: '0 0 20px 0',
            letterSpacing: '-0.02em',
          }}
        >
          Conversation History
        </h1>

        {/* Search & Filter controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 24,
            position: 'relative',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <Search size={16} style={{ color: '#94a3b8' }} aria-hidden />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 13,
                color: '#0f172a',
              }}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label="Filter conversations"
              onClick={() => setFilterMenuOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                background: filterMode !== 'all' ? '#f1f5f9' : '#ffffff',
                color: filterMode !== 'all' ? '#0284c7' : '#64748b',
                cursor: 'pointer',
              }}
            >
              <Filter size={16} />
            </button>
            {filterMenuOpen ? (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  width: 150,
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                  zIndex: 50,
                  padding: '4px 0',
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFilterMode('all')
                    setFilterMenuOpen(false)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 12px',
                    border: 'none',
                    background: filterMode === 'all' ? '#f1f5f9' : 'transparent',
                    fontSize: 12,
                    fontWeight: filterMode === 'all' ? 600 : 400,
                    cursor: 'pointer',
                    color: '#0f172a',
                  }}
                >
                  All Conversations
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFilterMode('active')
                    setFilterMenuOpen(false)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 12px',
                    border: 'none',
                    background: filterMode === 'active' ? '#f1f5f9' : 'transparent',
                    fontSize: 12,
                    fontWeight: filterMode === 'active' ? 600 : 400,
                    cursor: 'pointer',
                    color: '#0f172a',
                  }}
                >
                  Active Only
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setFilterMode('archived')
                    setFilterMenuOpen(false)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 12px',
                    border: 'none',
                    background: filterMode === 'archived' ? '#f1f5f9' : 'transparent',
                    fontSize: 12,
                    fontWeight: filterMode === 'archived' ? 600 : 400,
                    cursor: 'pointer',
                    color: '#0f172a',
                  }}
                >
                  Archived Only
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            aria-label="Options"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            <MoreVertical size={16} />
          </button>
        </div>

        {/* Conversations List */}
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, color: '#94a3b8' }}>
            <Loader2 size={20} className="spin" style={{ marginRight: 8 }} />
            <span>Loading conversations...</span>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#64748b' }}>
            <Clock size={32} style={{ color: '#cbd5e1', marginBottom: 12 }} />
            <p style={{ margin: '0 0 12px 0', fontSize: 14 }}>No conversations found</p>
            {onNewSession ? (
              <button
                type="button"
                onClick={onNewSession}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: '#0f172a',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Start new conversation
              </button>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredSessions.map((session) => {
              const relTime = formatRelativeTime(session.updatedAt || session.createdAt)
              return (
                <div
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'background 150ms ease',
                    background: '#ffffff',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {session.title}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        color: '#64748b',
                      }}
                    >
                      {session.projectName === 'Outside of Project' ? (
                        <FileText size={13} style={{ color: '#94a3b8' }} />
                      ) : (
                        <Folder size={13} style={{ color: '#94a3b8' }} />
                      )}
                      <span>{session.projectName}</span>
                      {session.isArchived ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: '#f1f5f9',
                            color: '#64748b',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <Archive size={10} /> Archived
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 12,
                      color: '#64748b',
                      marginLeft: 16,
                      flexShrink: 0,
                    }}
                  >
                    {relTime === 'now' ? (
                      <>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            border: '2px solid #0284c7',
                            borderTopColor: 'transparent',
                            display: 'inline-block',
                            animation: 'spin 1s linear infinite',
                          }}
                        />
                        <span style={{ fontWeight: 500, color: '#0284c7' }}>now</span>
                      </>
                    ) : (
                      <>
                        <Calendar size={13} style={{ color: '#94a3b8' }} />
                        <span>{relTime}</span>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
