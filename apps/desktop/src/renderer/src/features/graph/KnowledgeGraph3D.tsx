'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { buildWikiGraph } from '@/lib/client/api'

type NodeType = 'entity' | 'concept' | 'source' | 'overview' | 'other'
interface GraphNode { id: string; label: string; type: NodeType; x?: number; y?: number; z?: number; linkCount?: number }
interface GraphEdge { source: string; target: string; weight?: number }

const TYPE_COLOR: Record<NodeType, string> = {
  entity: '#60a5fa',
  concept: '#c084fc',
  source: '#fb923c',
  overview: '#facc15',
  other: '#94a3b8',
}

const MOCK_NODES: GraphNode[] = [
  { id: 'wiki-log', label: 'Wiki Log', type: 'other', linkCount: 12 },
  { id: 'wiki-index', label: 'Wiki Index', type: 'other', linkCount: 8 },
  { id: 'project-overview', label: 'Project Overview', type: 'overview', linkCount: 5 },
  { id: 'epa', label: 'EPA (United States Environmental Protection Agency)', type: 'entity', linkCount: 6 },
  { id: 'ethanol', label: 'Ethanol', type: 'entity', linkCount: 5 },
  { id: 'denitrification', label: 'Denitrification', type: 'concept', linkCount: 7 },
  { id: 'lstm', label: 'LSTM', type: 'entity', linkCount: 4 },
  { id: 'biodiesel-glycerol', label: 'Glycerol (Biodiesel By-product)', type: 'concept', linkCount: 3 },
  { id: 'molasses', label: 'Molasses', type: 'entity', linkCount: 3 },
  { id: 'vinasse', label: 'Vinasse', type: 'entity', linkCount: 2 },
  { id: 'nitrification', label: 'Nitrification', type: 'concept', linkCount: 2 },
  { id: 'bod', label: 'BOD (生化需氧量)', type: 'entity', linkCount: 4 },
  { id: 'vfa', label: 'Volatile Fatty Acids (VFAs)', type: 'concept', linkCount: 3 },
  { id: 'dpaos', label: 'DPAOs (反硝化聚磷菌)', type: 'entity', linkCount: 4 },
  { id: 'deng', label: 'TDengine', type: 'entity', linkCount: 2 },
  { id: 'influxdb', label: 'InfluxDB', type: 'entity', linkCount: 3 },
  { id: 'scada', label: 'SCADA系统', type: 'entity', linkCount: 3 },
  { id: 'modbus', label: 'Modbus', type: 'entity', linkCount: 2 },
  { id: 'mqtt', label: 'MQTT', type: 'entity', linkCount: 2 },
  { id: 'paos', label: 'Polyphosphate-Accumulating Organisms (PAOs)', type: 'entity', linkCount: 5 },
  { id: 'src-scada', label: 'Source: research-scada-2026-04-07.md', type: 'source', linkCount: 1 },
  { id: 'src-dpa', label: 'Source: research-post-anoxic-technical-design-2026-04-09.md', type: 'source', linkCount: 1 },
  { id: 'src-2', label: 'Source: research--2026-04-08.md', type: 'source', linkCount: 1 },
]

const MOCK_EDGES: GraphEdge[] = [
  { source: 'wiki-log', target: 'wiki-index' }, { source: 'wiki-log', target: 'epa' }, { source: 'wiki-log', target: 'denitrification' }, { source: 'wiki-log', target: 'vfa' }, { source: 'wiki-log', target: 'dpaos' },
  { source: 'epa', target: 'ethanol' }, { source: 'ethanol', target: 'denitrification' }, { source: 'biodiesel-glycerol', target: 'denitrification' }, { source: 'molasses', target: 'vinasse' }, { source: 'vinasse', target: 'biodiesel-glycerol' },
  { source: 'deng', target: 'influxdb' }, { source: 'tdeng', target: 'influxdb' } as any, { source: 'epa', target: 'modbus' }, { source: 'scada', target: 'modbus' }, { source: 'scada', target: 'mqtt' },
  { source: 'paos', target: 'dpaos' }, { source: 'project-overview', target: 'epa' }, { source: 'src-scada', target: 'scada' }, { source: 'src-dpa', target: 'ethanol' }, { source: 'src-2', target: 'paos' },
  { source: 'lstm', target: 'biodiesel-glycerol' } as any, { source: 'bod', target: 'dpaos' },
]

function nodeSize(linkCount: number): number {
  const ratio = Math.min(1, linkCount / 12)
  return 0.35 + Math.sqrt(ratio) * 0.9
}

export function KnowledgeGraph3D({ nodes: propNodes, edges: propEdges, workspaceRoot, highlightQuery }: { nodes?: GraphNode[]; edges?: GraphEdge[]; workspaceRoot?: string; highlightQuery?: string }): React.JSX.Element {
  const [fetchedNodes, setFetchedNodes] = useState<GraphNode[] | null>(null)
  const [fetchedEdges, setFetchedEdges] = useState<GraphEdge[] | null>(null)
  const [wikiHint, setWikiHint] = useState<string | null>(null)
  // Auto-fetch wiki folder (no hardcode) — syncs with chat context via highlightQuery
  useEffect(() => {
    if (propNodes) return
    let cancelled = false
    buildWikiGraph(workspaceRoot).then((r) => {
      if (cancelled) return
      if (r.ok && r.nodes.length > 0) {
        setFetchedNodes(r.nodes as unknown as GraphNode[])
        setFetchedEdges(r.edges as unknown as GraphEdge[])
        setWikiHint(null)
      } else if (r.hint) {
        setWikiHint(r.hint)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [workspaceRoot, propNodes])

  // Automap: when highlightQuery (current chat input / last message) changes, highlight matching nodes
  const autoHighlighted = useMemo(() => {
    if (!highlightQuery || highlightQuery.trim().length < 2) return new Set<string>()
    const q = highlightQuery.toLowerCase()
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6)
    const matched = new Set<string>()
    const all = propNodes ?? fetchedNodes ?? MOCK_NODES
    for (const n of all) {
      const label = n.label.toLowerCase()
      if (tokens.some((t) => label.includes(t))) matched.add(n.id)
    }
    return matched
  }, [highlightQuery, propNodes, fetchedNodes])

  const nodes = propNodes ?? fetchedNodes ?? MOCK_NODES
  const edges = propEdges ?? fetchedEdges ?? MOCK_EDGES
  const mountRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const effectiveHovered = hovered ?? (autoHighlighted.size === 1 ? Array.from(autoHighlighted)[0] : null)
  const positions = useMemo(() => {
    const map = new Map<string, THREE.Vector3>()
    for (const n of nodes) {
      if (n.id === 'wiki-log') map.set(n.id, new THREE.Vector3(0, 0, 0))
      else if (n.id === 'wiki-index') map.set(n.id, new THREE.Vector3(-4, -3, 2))
      else if (n.id === 'project-overview') map.set(n.id, new THREE.Vector3(2, 2, -1))
      else {
        const angle = Math.random() * Math.PI * 2
        const r = 4 + Math.random() * 6
        const y = (Math.random() - 0.5) * 6
        map.set(n.id, new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r))
      }
    }
    return map
  }, [nodes])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const width = mount.clientWidth
    const height = mount.clientHeight
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#ffffff')
    scene.fog = new THREE.Fog('#ffffff', 18, 40)

    const camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 1000)
    camera.position.set(0, 6, 14)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    mount.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 0.9)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.7)
    dir.position.set(5, 10, 7)
    scene.add(dir)

    // Grid + subtle ground
    const grid = new THREE.GridHelper(30, 30, 0xe2e8f0, 0xf1f5f9)
    grid.position.y = -4
    scene.add(grid)

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    const spheres = new Map<string, THREE.Mesh>()
    const labels = new Map<string, THREE.Sprite>()

    // Create nodes as spheres
    for (const n of nodes) {
      const pos = positions.get(n.id)!
      const geom = new THREE.SphereGeometry(nodeSize(n.linkCount ?? 1), 24, 24)
      const mat = new THREE.MeshStandardMaterial({ color: TYPE_COLOR[n.type] ?? TYPE_COLOR.other, roughness: 0.35, metalness: 0.15, emissive: TYPE_COLOR[n.type] ?? '#94a3b8', emissiveIntensity: 0.12 })
      const mesh = new THREE.Mesh(geom, mat)
      mesh.position.copy(pos)
      mesh.userData = { id: n.id, label: n.label, type: n.type }
      scene.add(mesh)
      spheres.set(n.id, mesh)

      // Label sprite (canvas)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const label = n.label.length > 22 ? n.label.slice(0, 22) + '…' : n.label
      ctx.font = '600 24px Manrope, system-ui'
      const w = ctx.measureText(label).width + 24
      canvas.width = w
      canvas.height = 32
      ctx.font = '600 24px Manrope, system-ui'
      ctx.fillStyle = 'rgba(15,23,42,0.92)'
      // @ts-ignore rounded rect
      const r = 8; ctx.beginPath(); ctx.moveTo(r,0); ctx.lineTo(w-r,0); ctx.quadraticCurveTo(w,0,w, r); ctx.lineTo(w,32-r); ctx.quadraticCurveTo(w,32,w-r,32); ctx.lineTo(r,32); ctx.quadraticCurveTo(0,32,0,32-r); ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, 12, 22)
      const tex = new THREE.CanvasTexture(canvas)
      const sprMat = new THREE.SpriteMaterial({ map: tex, transparent: true })
      const sprite = new THREE.Sprite(sprMat)
      sprite.scale.set(w / 80, 0.4, 1)
      sprite.position.set(pos.x, pos.y + nodeSize(n.linkCount ?? 1) + 0.45, pos.z)
      scene.add(sprite)
      labels.set(n.id, sprite)
    }

    // Edges as lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.55 })
    for (const e of edges) {
      const a = positions.get(e.source), b = positions.get(e.target)
      if (!a || !b) continue
      const pts = [a.clone(), b.clone()]
      const geom = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.Line(geom, lineMat.clone())
      const w = (e.weight ?? 0.5)
      ;(line.material as THREE.LineBasicMaterial).opacity = 0.25 + w * 0.4
      scene.add(line)
    }

    // Simple orbit via mouse drag
    let isDragging = false, prevX = 0, prevY = 0, rotY = 0, rotX = 0.12
    let dist = 14
    const updateCamera = () => {
      const y = Math.sin(rotX) * dist
      const r = Math.cos(rotX) * dist
      camera.position.set(Math.sin(rotY) * r, y + 2, Math.cos(rotY) * r)
      camera.lookAt(0, 0, 0)
    }
    updateCamera()
    const onDown = (e: MouseEvent) => { isDragging = true; prevX = e.clientX; prevY = e.clientY }
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return
      rotY -= (e.clientX - prevX) * 0.006
      rotX = Math.max(-0.6, Math.min(0.7, rotX + (e.clientY - prevY) * 0.006))
      prevX = e.clientX; prevY = e.clientY; updateCamera()
    }
    const onUp = () => { isDragging = false }
    const onWheel = (e: WheelEvent) => { e.preventDefault(); dist = Math.max(6, Math.min(30, dist + e.deltaY * 0.012)); updateCamera() }
    renderer.domElement.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(Array.from(spheres.values()))
      if (hits[0]) {
        const id = (hits[0].object as THREE.Mesh).userData.id as string
        const n = nodes.find((x) => x.id === id) ?? null
        setSelected(n)
        setHovered(id)
      } else setHovered(null)
    }
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(Array.from(spheres.values()))
      const id = hits[0] ? (hits[0].object as THREE.Mesh).userData.id as string : null
      setHovered(id)
      renderer.domElement.style.cursor = id ? 'pointer' : 'grab'
    })

    let raf = 0
    const animate = () => {
      raf = requestAnimationFrame(animate)
      // gentle float + automap pulse for chat context
      const t = Date.now() * 0.00035
      for (const [id, mesh] of spheres) {
        const base = positions.get(id)!
        mesh.position.y = base.y + Math.sin(t + id.length) * 0.18
        const lab = labels.get(id)
        if (lab) lab.position.y = mesh.position.y + nodeSize(nodes.find((n) => n.id === id)?.linkCount ?? 1) + 0.45
        const isH = hovered === id || autoHighlighted.has(id)
        const isAuto = autoHighlighted.has(id) && hovered !== id
        const scale = isH ? 1.22 : 1
        mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, scale, 0.12))
        ;(mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isH ? (isAuto ? 0.22 : 0.28) : 0.12
        if (isAuto) {
          ;(mesh.material as THREE.MeshStandardMaterial).color.setHSL( (Date.now()*0.0005 + id.length*0.1)%1, 0.7, 0.6)
        }
      }
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      if (!mount) return
      const w = mount.clientWidth, h = mount.clientHeight
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('click', onClick)
      mount.removeChild(renderer.domElement)
      renderer.dispose()
    }
  }, [nodes, edges, positions, hovered, autoHighlighted])

  // Left list now syncs to wiki folder (not hardcode) — shows fetched entities, automapped to chat
  const entityNodes = nodes.filter((n) => n.type === 'entity')
  const wikiDisplayCount = nodes.length
  return (
    <div style={{ display: 'flex', height: '100%', background: '#ffffff' }}>
      {/* Left Knowledge list like image — now dynamic from wiki folder, not hardcode */}
      <div style={{ width: 240, borderRight: '1px solid #e2e8f0', overflowY: 'auto', padding: '12px 10px', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#0f172a' }}>Knowledge</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{wikiHint ? 'No wiki yet' : `Wiki • ${wikiDisplayCount} pages`}</div>
        {wikiHint ? <div style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: '6px 8px', borderRadius: 6, marginBottom: 8 }}>{wikiHint}</div> : <div style={{ fontWeight: 600, fontSize: 12, background: '#f1f5f9', padding: '6px 8px', borderRadius: 6, marginBottom: 8 }}>Overview {nodes.filter((n) => n.type === 'overview').length || 1}</div>}
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Entities {entityNodes.length}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#334155' }}>
          {entityNodes.slice(0, 16).map((n) => {
            const isH = hovered === n.id || autoHighlighted.has(n.id)
            return <div key={n.id} style={{ padding: '3px 8px', borderRadius: 4, background: isH ? (autoHighlighted.has(n.id) ? '#fef3c7' : '#f1f5f9') : 'transparent', cursor: 'pointer', fontWeight: isH ? 600 : 400, borderLeft: autoHighlighted.has(n.id) ? '2px solid #f59e0b' : '2px solid transparent' }} onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)}>{n.label}</div>
          })}
          {entityNodes.length === 0 ? <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 8px' }}>No entities yet — add wiki/entities/*.md with [[wikilinks]]</div> : null}
        </div>
      </div>

      {/* Center 3D canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', display: 'inline-block', boxShadow: '0 0 8px #38bdf8' }} /> Knowledge Graph
            <span style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: 999, color: '#64748b' }}>{nodes.length} pages</span>
            <span style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: 999, color: '#64748b' }}>{edges.length} links</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#ffffff' }}>Type</span>
            <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#ffffff' }}>Community</span>
            <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e' }}>Insights 9</span>
          </div>
        </div>
        <div ref={mountRef} style={{ flex: 1, minHeight: 0, cursor: 'grab', background: '#ffffff' }} />

        {/* Legend like image */}
        <div style={{ position: 'absolute', left: 252, bottom: 12, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 10px', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', fontSize: 11 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#0f172a' }}>Node Types</div>
          {(Object.entries(TYPE_COLOR) as [NodeType, string][]).map(([k, c]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block' }} /> {k} <span style={{ color: '#94a3b8' }}>{MOCK_NODES.filter((n) => n.type === k).length}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right detail like image */}
      <div style={{ width: 300, borderLeft: '1px solid #e2e8f0', overflowY: 'auto', padding: '12px 14px', background: '#ffffff', flexShrink: 0 }}>
        {selected ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{selected.label}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, textTransform: 'uppercase' }}>{selected.type}</div>
            <div style={{ marginTop: 10, fontSize: 12, color: '#334155', lineHeight: 1.6 }}>3D node • {selected.linkCount} links • drag to orbit, scroll to zoom, click to focus.</div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>4. Carbon source optimization strategies</div>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>Key Entities to identify:</div>
            <div style={{ marginTop: 6 }}>1. PAOs (聚磷菌) - central topic<br/>2. Various PAO genera…<br/>3. Related organisms: GAOs…</div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>Drag to orbit • Scroll to zoom • Hover nodes</div>
          </div>
        )}
      </div>
    </div>
  )
}
