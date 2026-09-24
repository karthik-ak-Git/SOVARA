'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { buildWikiGraph } from '@/lib/client/api'

type NodeType = 'entity' | 'concept' | 'source' | 'overview' | 'other'
interface GraphNode { id: string; label: string; type: NodeType; path: string; linkCount: number; x?: number; y?: number }
interface GraphEdge { source: string; target: string; weight?: number }

const TYPE_COLOR: Record<NodeType, string> = {
  entity: '#3b82f6',
  concept: '#a855f7',
  source: '#f97316',
  overview: '#eab308',
  other: '#64748b',
}

export function KnowledgeGraph3D({ workspaceRoot, highlightQuery }: { workspaceRoot?: string; highlightQuery?: string }): React.JSX.Element {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [wikiDir, setWikiDir] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch wiki folder — no hardcode, live from disk
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    buildWikiGraph(workspaceRoot).then((r) => {
      if (cancelled) return
      if (r.ok && r.nodes.length > 0) {
        // Assign 2D positions via circular layout (properly connected, not 3D floating)
        const positioned = r.nodes.map((n, i) => {
          const angle = (i / r.nodes.length) * Math.PI * 2
          const radius = 180 + (n.linkCount * 12)
          return { ...n, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
        })
        // Center hubs
        for (const n of positioned) {
          if (n.id.includes('wiki-log') || n.label === 'Wiki Log') { n.x = 0; n.y = 0 }
          if (n.id.includes('wiki-index') || n.label === 'Wiki Index') { n.x = -80; n.y = 80 }
        }
        setNodes(positioned as GraphNode[])
        setEdges(r.edges as GraphEdge[])
        setWikiDir(r.wikiDir)
        setHint(null)
      } else {
        setNodes([])
        setEdges([])
        setWikiDir(r.wikiDir)
        setHint(r.hint ?? 'No wiki files yet — create markdown files in wiki/ with [[wikilinks]] to build the graph. File creation via chat (fs_write) auto-creates wiki pages and updates graph.')
      }
      setLoading(false)
    }).catch(() => { if (!cancelled) { setLoading(false); setHint('Failed to read wiki folder') } })
    return () => { cancelled = true }
  }, [workspaceRoot])

  // Automap from chat context: highlight matching nodes
  const highlighted = useMemo(() => {
    if (!highlightQuery || highlightQuery.trim().length < 2) return new Set<string>()
    const tokens = highlightQuery.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
    const set = new Set<string>()
    for (const n of nodes) {
      const label = n.label.toLowerCase()
      if (tokens.some((t) => label.includes(t))) set.add(n.id)
    }
    return set
  }, [highlightQuery, nodes])

  // 2D Canvas render — properly connected edges, not 3D spheres
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || nodes.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio)
    const rect = container.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    let raf = 0
    let offsetX = 0, offsetY = 0, scale = 1
    let isDragging = false, startX = 0, startY = 0, lastOffX = 0, lastOffY = 0

    const draw = () => {
      ctx.clearRect(0, 0, rect.width, rect.height)
      ctx.save()
      ctx.translate(centerX + offsetX, centerY + offsetY)
      ctx.scale(scale, scale)

      // Edges — properly connected lines
      for (const e of edges) {
        const a = nodeMap.get(e.source), b = nodeMap.get(e.target)
        if (!a || !b || a.x === undefined || b.x === undefined) continue
        const isHoverEdge = hovered === e.source || hovered === e.target || highlighted.has(e.source) && highlighted.has(e.target)
        ctx.beginPath()
        ctx.moveTo(a.x!, a.y!)
        ctx.lineTo(b.x!, b.y!)
        ctx.strokeStyle = isHoverEdge ? '#334155' : 'rgba(148,163,184,0.35)'
        ctx.lineWidth = isHoverEdge ? 2 : 0.8
        ctx.stroke()
      }

      // Nodes — 2D circles with labels
      for (const n of nodes) {
        if (n.x === undefined) continue
        const isH = hovered === n.id || highlighted.has(n.id)
        const r = 8 + Math.sqrt((n.linkCount ?? 1)) * 3
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, isH ? r * 1.25 : r, 0, Math.PI * 2)
        ctx.fillStyle = TYPE_COLOR[n.type] ?? TYPE_COLOR.other
        if (isH) { ctx.shadowColor = TYPE_COLOR[n.type]; ctx.shadowBlur = 12 }
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = isH ? '#0f172a' : 'rgba(255,255,255,0.9)'
        ctx.lineWidth = isH ? 2 : 1
        ctx.stroke()

        // Label
        ctx.fillStyle = '#0f172a'
        ctx.font = `${isH ? '700' : '500'} 11px Manrope, system-ui`
        ctx.textAlign = 'center'
        const label = n.label.length > 18 ? n.label.slice(0, 18) + '…' : n.label
        ctx.fillText(label, n.x!, n.y! + r + 12)
      }
      ctx.restore()
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.92 : 1.08
      scale = Math.max(0.4, Math.min(3, scale * delta))
      draw()
    }
    const onDown = (e: MouseEvent) => { isDragging = true; startX = e.clientX - lastOffX; startY = e.clientY - lastOffY; canvas.style.cursor = 'grabbing' }
    const onMove = (e: MouseEvent) => {
      if (!isDragging) {
        // hover detection
        const rect2 = canvas.getBoundingClientRect()
        const x = (e.clientX - rect2.left - centerX - offsetX) / scale
        const y = (e.clientY - rect2.top - centerY - offsetY) / scale
        let hit: string | null = null
        for (const n of nodes) {
          if (n.x === undefined) continue
          const r = 8 + Math.sqrt((n.linkCount ?? 1)) * 3
          const dx = x - n.x!, dy = y - n.y!
          if (dx * dx + dy * dy < (r + 4) * (r + 4)) { hit = n.id; break }
        }
        setHovered(hit)
        canvas.style.cursor = hit ? 'pointer' : 'grab'
        return
      }
      offsetX = e.clientX - startX
      offsetY = e.clientY - startY
      lastOffX = offsetX; lastOffY = offsetY
      draw()
    }
    const onUp = () => { isDragging = false; canvas.style.cursor = 'grab' }
    const onClick = (e: MouseEvent) => {
      const rect2 = canvas.getBoundingClientRect()
      const x = (e.clientX - rect2.left - centerX - offsetX) / scale
      const y = (e.clientY - rect2.top - centerY - offsetY) / scale
      for (const n of nodes) {
        if (n.x === undefined) continue
        const r = 8 + Math.sqrt((n.linkCount ?? 1)) * 3
        const dx = x - n.x!, dy = y - n.y!
        if (dx * dx + dy * dy < (r + 4) * (r + 4)) { setSelected(n); return }
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('click', onClick)

    draw()
    const onResize = () => {
      const r = container.getBoundingClientRect()
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('click', onClick)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
    }
  }, [nodes, edges, hovered, highlighted])

  const entityNodes = nodes.filter((n) => n.type === 'entity')
  const conceptNodes = nodes.filter((n) => n.type === 'concept')

  if (loading) {
    return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>Loading wiki graph from {wikiDir ?? 'wiki/'}…</div>
  }

  if (nodes.length === 0) {
    return (
      <div style={{ display: 'flex', height: '100%', background: '#ffffff' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 12 }}>📄</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>No knowledge graph yet</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, maxWidth: 360, lineHeight: 1.5 }}>{hint ?? 'Wiki folder is empty. Create markdown files in wiki/ with YAML frontmatter and [[wikilinks]] — or let chat create files via fs_write. The graph auto-builds from real files, not dummy data.'}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, background: '#f8fafc', padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0' }}>wikiDir: {wikiDir ?? 'not found'}</div>
          <div style={{ marginTop: 16, fontSize: 11, color: '#64748b', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 12px', borderRadius: 8, textAlign: 'left', maxWidth: 400 }}>
            <div style={{ fontWeight: 600, color: '#92400e' }}>What it actually does:</div>
            <div style={{ marginTop: 4, lineHeight: 1.6 }}>
              • Chat <code>fs_write</code> creates <code>wiki/entities/*.md</code> or <code>wiki/concepts/*.md</code> with frontmatter<br/>
              • Each file’s <code>[[wikilink]]</code> becomes an edge<br/>
              • Graph rebuilds on every open — no hardcode, fully synced to chat context and wiki folder
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: '#ffffff' }}>
      {/* Left Knowledge list — dynamic from wiki, not hardcode */}
      <div style={{ width: 220, borderRight: '1px solid #e2e8f0', overflowY: 'auto', padding: '12px 10px', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#0f172a' }}>Knowledge</div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{wikiDir ? wikiDir.split(/[/\\]/).pop() : 'Wiki'} • {nodes.length} pages</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Entities {entityNodes.length}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#334155' }}>
          {entityNodes.slice(0, 16).map((n) => {
            const isH = hovered === n.id || highlighted.has(n.id)
            return <div key={n.id} style={{ padding: '4px 8px', borderRadius: 6, background: isH ? (highlighted.has(n.id) ? '#fef3c7' : '#f1f5f9') : 'transparent', cursor: 'pointer', fontWeight: isH ? 600 : 400, borderLeft: highlighted.has(n.id) ? '2px solid #f59e0b' : '2px solid transparent' }} onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)} onClick={() => setSelected(n)}>{n.label}</div>
          })}
          {conceptNodes.length > 0 ? <><div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, marginBottom: 2 }}>Concepts {conceptNodes.length}</div>{conceptNodes.slice(0, 8).map((n) => <div key={n.id} style={{ padding: '3px 8px', fontSize: 11, color: '#7c3aed' }} onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)}>{n.label}</div>)}</> : null}
        </div>
        <div style={{ marginTop: 12, padding: '8px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 11, color: '#64748b' }}>
          <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>Node Types</div>
          {(Object.entries(TYPE_COLOR) as [NodeType, string][]).filter(([k]) => nodes.some((n) => n.type === k)).map(([k, c]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block' }} /> {k} <span style={{ color: '#94a3b8', marginLeft: 'auto' }}>{nodes.filter((n) => n.type === k).length}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Center 2D canvas — properly connected, not 3D floating */}
      <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
            Knowledge Graph
            <span style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: 999, color: '#64748b' }}>{nodes.length} pages</span>
            <span style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: 999, color: '#64748b' }}>{edges.length} links</span>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>2D • drag to pan • scroll to zoom • click node</div>
        </div>
        <div style={{ flex: 1, position: 'relative', background: '#ffffff', overflow: 'hidden' }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', cursor: 'grab', display: 'block' }} />
        </div>
      </div>

      {/* Right detail */}
      <div style={{ width: 280, borderLeft: '1px solid #e2e8f0', overflowY: 'auto', padding: '12px 14px', background: '#ffffff', flexShrink: 0 }}>
        {selected ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{selected.label}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, textTransform: 'uppercase' }}>{selected.type} • {selected.linkCount} links • {selected.path}</div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#334155', lineHeight: 1.6, background: '#f8fafc', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              File: <code style={{ fontSize: 11 }}>{selected.path}</code><br/>
              Click to open in wiki folder. Edges = [[wikilinks]] in this file.
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>How it works</div>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: '#92400e' }}>No hardcode — live wiki:</div>
              <div style={{ marginTop: 4 }}>
                • Chat <code>fs_write wiki/entities/Dechloromonas.md</code> with <code>--- type: entity ---</code> + <code>[[Wiki Log]]</code><br/>
                • Graph rebuilds from <code>wikiDir: {wikiDir ?? 'wiki/'}</code><br/>
                • Context: recent chat + retrieved wiki pages (via <code>contextBudget 60/20/5/15</code>) highlight matching nodes (amber)
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}>Pan • Zoom • Hover • Click</div>
          </div>
        )}
      </div>
    </div>
  )
}
