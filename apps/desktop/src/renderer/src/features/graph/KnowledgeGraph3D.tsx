'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { buildWikiGraph, onSessionEvents } from '@/lib/client/api'
import { useChatStore } from '@/stores/chatStore'

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
  const [reloadKey, setReloadKey] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // View state lives in refs so pan/zoom survives hover re-renders (was resetting every hover)
  const viewRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 })
  const fittedKeyRef = useRef<string | null>(null)
  // Debounce live refetches so a burst of tool/artifact events triggers one rebuild
  const reloadTimer = useRef<number | null>(null)
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => setReloadKey((k) => k + 1), 800)
  }, [])
  // Highlight: explicit prop wins; otherwise derive trivially from the current
  // chat store (last user message) so open chat context highlights matching nodes.
  const storeEvents = useChatStore((s) => s.events)
  const storeStreamingText = useChatStore((s) => s.streamingText)
  const derivedQuery = useMemo(() => {
    void storeStreamingText
    for (let i = storeEvents.length - 1; i >= 0; i--) {
      const e = storeEvents[i]
      if (!e || e.type !== 'user/message') continue
      const content = (e.data as { content?: unknown } | null)?.content
      if (typeof content === 'string' && content.trim().length >= 2) return content.slice(0, 200)
    }
    return undefined
  }, [storeEvents, storeStreamingText])
  const effectiveHighlight = highlightQuery && highlightQuery.trim().length >= 2 ? highlightQuery : derivedQuery

  // Fetch wiki folder — no hardcode, live from disk
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    buildWikiGraph(workspaceRoot).then((r) => {
      if (cancelled) return
      if (r.ok && r.nodes.length > 0) {
        // Seed 2D positions on a ring (instant paint), then refine off-thread
        // via the ForceAtlas2 worker — dots spread, connected dots pull together.
        const seed = r.nodes.map((n, i) => {
          const angle = (i / r.nodes.length) * Math.PI * 2
          // Ring sized by node count — fit-to-view handles final scale, avoids pile-ups
          const radius = Math.min(460, 130 + r.nodes.length * 9)
          return { ...n, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
        })
        // Center hubs
        for (const n of seed) {
          if (n.id.includes('wiki-log') || n.label === 'Wiki Log') { n.x = 0; n.y = 0 }
          if (n.id.includes('wiki-index') || n.label === 'Wiki Index') { n.x = -80; n.y = 80 }
        }
        fittedKeyRef.current = null // new dataset → re-fit view
        setNodes(seed as GraphNode[])
        setEdges(r.edges as GraphEdge[])
        setWikiDir(r.wikiDir)
        setHint(null)
        if (!cancelled && seed.length > 2 && seed.length <= 3000) {
          try {
            const worker = new Worker(new URL('./graph-layout-worker.ts', import.meta.url), { type: 'module' })
            const kill = window.setTimeout(() => worker.terminate(), 20000)
            worker.onmessage = (ev: MessageEvent<{ positions: Array<{ id: string; x: number; y: number }> }>) => {
              window.clearTimeout(kill)
              const pos = new Map(ev.data.positions.map((p) => [p.id, p]))
              if (!cancelled) {
                setNodes((prev) =>
                  prev.length === seed.length
                    ? (prev.map((n) => {
                        const p = pos.get(n.id)
                        return p ? { ...n, x: p.x, y: p.y } : n
                      }) as GraphNode[])
                    : prev,
                )
              }
              worker.terminate()
            }
            worker.onerror = () => {
              window.clearTimeout(kill)
              worker.terminate()
            }
            worker.postMessage({
              key: seed.map((n) => n.id).join('|'),
              nodes: seed.map((n) => ({ id: n.id, x: n.x, y: n.y })),
              edges: r.edges,
              iterations: Math.min(400, 80 + seed.length * 2),
              scalingRatio: 10,
            })
          } catch {
            // ring seed stands — graph still renders as 2D dots + lines
          }
        }
      } else {
        setNodes([])
        setEdges([])
        setWikiDir(r.wikiDir)
        setHint(r.hint ?? 'No wiki files yet — create markdown files in wiki/ with [[wikilinks]] to build the graph. File creation via chat (fs_write) auto-creates wiki pages and updates graph.')
      }
      setLoading(false)
    }).catch(() => { if (!cancelled) { setLoading(false); setHint('Failed to read wiki folder') } })
    return () => { cancelled = true }
  }, [workspaceRoot, reloadKey])

  // Live refetch: fs_write tool completions and generated artifacts mutate
  // wiki files — rebuild on those `events:session` pushes (existing channel,
  // no new IPC) instead of only on workspaceRoot change.
  useEffect(() => {
    const dispose = onSessionEvents((ev) => {
      if (!ev) return
      if (ev.kind === 'artifact:ready') {
        scheduleReload()
        return
      }
      if (ev.kind === 'tool:end' && (ev.toolName === 'fs_write' || ev.toolName === 'memory')) {
        scheduleReload()
      }
    })
    return () => {
      dispose()
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    }
  }, [scheduleReload])

  // Automap from chat context: highlight matching nodes
  const highlighted = useMemo(() => {
    if (!effectiveHighlight || effectiveHighlight.trim().length < 2) return new Set<string>()
    const tokens = effectiveHighlight.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
    const set = new Set<string>()
    for (const n of nodes) {
      const label = n.label.toLowerCase()
      if (tokens.some((t) => label.includes(t))) set.add(n.id)
    }
    return set
  }, [effectiveHighlight, nodes])

  // 2D Canvas render — measured against the canvas wrapper ONLY (not the header column),
  // auto-fit once per dataset, view state in refs so hover never resets pan/zoom.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || nodes.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const view = viewRef.current
    const dpr = Math.min(2, window.devicePixelRatio)
    let width = 1
    let height = 1

    const resize = () => {
      const r = container.getBoundingClientRect()
      width = Math.max(1, Math.round(r.width))
      height = Math.max(1, Math.round(r.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Auto-fit: fit the whole graph inside the visible canvas with padding (once per dataset)
    const fitKey = nodes.map((n) => n.id).join('|')
    if (fittedKeyRef.current !== fitKey) {
      fittedKeyRef.current = fitKey
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of nodes) {
        if (n.x === undefined || n.y === undefined) continue
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x)
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y)
      }
      if (Number.isFinite(minX)) {
        const bw = Math.max(1, maxX - minX)
        const bh = Math.max(1, maxY - minY)
        const pad = 64
        const s = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh, 1.6)
        view.scale = Math.max(0.2, Math.min(1.6, Number.isFinite(s) && s > 0 ? s : 1))
        view.offsetX = -((minX + maxX) / 2) * view.scale
        view.offsetY = -((minY + maxY) / 2) * view.scale
      }
    }

    const radiusOf = (n: GraphNode) => 7 + Math.sqrt(Math.max(1, n.linkCount ?? 1)) * 3
    const toGraph = (clientX: number, clientY: number) => {
      const r2 = canvas.getBoundingClientRect()
      return {
        x: (clientX - r2.left - width / 2 - view.offsetX) / view.scale,
        y: (clientY - r2.top - height / 2 - view.offsetY) / view.scale,
      }
    }
    const hitTest = (gx: number, gy: number): GraphNode | null => {
      for (const n of nodes) {
        if (n.x === undefined || n.y === undefined) continue
        const r = radiusOf(n)
        const dx = gx - n.x, dy = gy - n.y
        if (dx * dx + dy * dy <= (r + 5) * (r + 5)) return n
      }
      return null
    }

    // Screen-space boxes for label overlap culling
    const boxes: Array<{ x: number; y: number; w: number; h: number }> = []
    const overlaps = (b: { x: number; y: number; w: number; h: number }) =>
      boxes.some((o) => !(b.x + b.w < o.x || o.x + o.w < b.x || b.y + b.h < o.y || o.y + o.h < b.y))

    const draw = () => {
      ctx.clearRect(0, 0, width, height)

      // ── Pass 1: graph-space edges + node circles ──
      ctx.save()
      ctx.translate(width / 2 + view.offsetX, height / 2 + view.offsetY)
      ctx.scale(view.scale, view.scale)

      for (const e of edges) {
        const a = nodeMap.get(e.source), b = nodeMap.get(e.target)
        if (!a || !b || a.x === undefined || b.x === undefined || a.y === undefined || b.y === undefined) continue
        const hot = hovered === e.source || hovered === e.target || (highlighted.has(e.source) && highlighted.has(e.target))
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = hot ? '#334155' : 'rgba(148,163,184,0.4)'
        ctx.lineWidth = (hot ? 2 : 0.9) / view.scale
        ctx.stroke()
      }

      const screenPos = new Map<string, { sx: number; sy: number; r: number }>()
      const ordered = [...nodes].sort((a, b) => radiusOf(a) - radiusOf(b)) // small first, hubs on top
      for (const n of ordered) {
        if (n.x === undefined || n.y === undefined) continue
        const isH = hovered === n.id || highlighted.has(n.id)
        const r = radiusOf(n)
        ctx.beginPath()
        ctx.arc(n.x, n.y, isH ? r * 1.22 : r, 0, Math.PI * 2)
        ctx.fillStyle = TYPE_COLOR[n.type] ?? TYPE_COLOR.other
        if (isH) { ctx.shadowColor = TYPE_COLOR[n.type]; ctx.shadowBlur = 10 / view.scale }
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = isH ? '#0f172a' : 'rgba(255,255,255,0.95)'
        ctx.lineWidth = (isH ? 2 : 1.2) / view.scale
        ctx.stroke()
        screenPos.set(n.id, {
          sx: width / 2 + view.offsetX + n.x * view.scale,
          sy: height / 2 + view.offsetY + n.y * view.scale,
          r: r * view.scale,
        })
      }
      ctx.restore()

      // ── Pass 2: screen-space labels (crisp text, pill bg, overlap-culled) ──
      boxes.length = 0
      const labelOrder = [...nodes].sort((a, b) => {
        const fa = (hovered === a.id || highlighted.has(a.id)) ? 1 : 0
        const fb = (hovered === b.id || highlighted.has(b.id)) ? 1 : 0
        if (fa !== fb) return fa - fb
        return (b.linkCount ?? 0) - (a.linkCount ?? 0)
      })
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const n of labelOrder) {
        const p = screenPos.get(n.id)
        if (!p) continue
        const isH = hovered === n.id || highlighted.has(n.id)
        const text = n.label.length > 22 ? n.label.slice(0, 22) + '…' : n.label
        ctx.font = `${isH ? '700' : '500'} ${isH ? 12 : 11}px Manrope, system-ui, sans-serif`
        const tw = ctx.measureText(text).width
        const box = { x: p.sx - tw / 2 - 5, y: p.sy + p.r + 3, w: tw + 10, h: 16 }
        if (box.x < -box.w || box.y < -box.h || box.x > width || box.y > height) continue // offscreen
        if (!isH && overlaps(box)) continue // cull overlapping quiet labels
        boxes.push(box)
        ctx.fillStyle = 'rgba(255,255,255,0.88)'
        ctx.beginPath()
        ctx.roundRect(box.x, box.y, box.w, box.h, 4)
        ctx.fill()
        if (isH) {
          ctx.strokeStyle = highlighted.has(n.id) ? '#f59e0b' : '#0f172a'
          ctx.lineWidth = 1
          ctx.stroke()
        }
        ctx.fillStyle = '#0f172a'
        ctx.fillText(text, p.sx, box.y + box.h / 2 + 0.5)
      }
    }

    let isDragging = false
    let startX = 0, startY = 0, baseX = 0, baseY = 0

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r2 = canvas.getBoundingClientRect()
      const sx = e.clientX - r2.left - width / 2
      const sy = e.clientY - r2.top - height / 2
      const gx = (sx - view.offsetX) / view.scale
      const gy = (sy - view.offsetY) / view.scale
      const factor = e.deltaY > 0 ? 0.9 : 1.111
      view.scale = Math.max(0.2, Math.min(4, view.scale * factor))
      // zoom toward cursor
      view.offsetX = sx - gx * view.scale
      view.offsetY = sy - gy * view.scale
      draw()
    }
    const onDown = (e: MouseEvent) => {
      isDragging = true
      startX = e.clientX; startY = e.clientY
      baseX = view.offsetX; baseY = view.offsetY
      canvas.style.cursor = 'grabbing'
    }
    const onMove = (e: MouseEvent) => {
      if (isDragging) {
        view.offsetX = baseX + (e.clientX - startX)
        view.offsetY = baseY + (e.clientY - startY)
        draw()
        return
      }
      const g = toGraph(e.clientX, e.clientY)
      const hit = hitTest(g.x, g.y)
      if ((hit?.id ?? null) !== hovered) setHovered(hit?.id ?? null)
      canvas.style.cursor = hit ? 'pointer' : 'grab'
    }
    const onUp = () => { isDragging = false; canvas.style.cursor = 'grab' }
    const onClick = (e: MouseEvent) => {
      if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) return // it was a drag
      const g = toGraph(e.clientX, e.clientY)
      const hit = hitTest(g.x, g.y)
      setSelected(hit)
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('click', onClick)

    const ro = new ResizeObserver(() => { resize(); draw() })
    ro.observe(container)

    draw()
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('click', onClick)
      ro.disconnect()
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
    <div style={{ display: 'flex', height: '100%', background: '#ffffff', position: 'relative', overflow: 'hidden' }}>
      {/* Left Knowledge list — dynamic from wiki, not hardcode */}
      <div style={{ width: 220, borderRight: '1px solid #e2e8f0', overflowY: 'auto', padding: '12px 10px', flexShrink: 0, background: '#ffffff', position: 'relative', zIndex: 1 }}>
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

      {/* Center 2D canvas — wrapper measured for canvas sizing (header excluded) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
            Knowledge Graph
            <span style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: 999, color: '#64748b' }}>{nodes.length} pages</span>
            <span style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: 999, color: '#64748b' }}>{edges.length} links</span>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>2D • drag to pan • scroll to zoom • click node</div>
        </div>
        <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative', background: '#ffffff', overflow: 'hidden' }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', cursor: 'grab', display: 'block' }} />
        </div>
      </div>

      {/* Right detail */}
      <div style={{ width: 280, borderLeft: '1px solid #e2e8f0', overflowY: 'auto', padding: '12px 14px', background: '#ffffff', flexShrink: 0, position: 'relative', zIndex: 1 }}>
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
