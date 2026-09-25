import { describe, it, expect } from 'vitest'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'

// Guards the exact graphology/ForceAtlas2 API surface used by
// renderer/src/features/graph/graph-layout-worker.ts (ported from
// test/llm_wiki). If these APIs break, the 2D worker breaks.
describe('graph layout worker dep contract', () => {
  it('inferSettings + assign spread a ring into finite 2D positions', () => {
    const graph = new Graph()
    const n = 12
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      graph.addNode(`n${i}`, { x: Math.cos(a) * 100, y: Math.sin(a) * 100 })
    }
    for (let i = 0; i < n; i++) {
      graph.addEdgeWithKey(`n${i}->n${(i + 1) % n}`, `n${i}`, `n${(i + 1) % n}`, { weight: 1 })
    }
    expect(graph.hasEdge('n0->n1')).toBe(true)
    const settings = forceAtlas2.inferSettings(graph)
    forceAtlas2.assign(graph, {
      iterations: 100,
      settings: { ...settings, gravity: 1, scalingRatio: 10, strongGravityMode: true, barnesHutOptimize: false },
    })
    let moved = 0
    graph.forEachNode((id, attrs) => {
      expect(Number.isFinite(attrs.x)).toBe(true)
      expect(Number.isFinite(attrs.y)).toBe(true)
      const i = Number(id.slice(1))
      const a = (i / n) * Math.PI * 2
      if (Math.abs(attrs.x - Math.cos(a) * 100) > 1e-6) moved++
    })
    expect(moved).toBeGreaterThan(0)
  })
})
