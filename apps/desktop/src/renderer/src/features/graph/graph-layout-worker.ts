import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'

interface LayoutRequest {
  key: string
  nodes: Array<{ id: string; x: number; y: number }>
  edges: Array<{ source: string; target: string; weight: number }>
  iterations: number
  scalingRatio: number
}

// ForceAtlas2 2D layout off the UI thread — dots spread by repulsion,
// connected nodes pulled together by springs. Ported from the
// test/llm_wiki reference (graph-layout-worker.ts) so the desktop graph
// mirrors its layout behavior without freezing the window.
self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { key, nodes, edges, iterations, scalingRatio } = event.data
  const graph = new Graph()

  for (const node of nodes) {
    graph.addNode(node.id, { x: node.x, y: node.y })
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
    const edgeKey = `${edge.source}->${edge.target}`
    if (graph.hasEdge(edgeKey) || graph.hasEdge(`${edge.target}->${edge.source}`)) continue
    graph.addEdgeWithKey(edgeKey, edge.source, edge.target, { weight: edge.weight })
  }

  const settings = forceAtlas2.inferSettings(graph)
  forceAtlas2.assign(graph, {
    iterations,
    settings: {
      ...settings,
      gravity: 1,
      scalingRatio,
      strongGravityMode: true,
      barnesHutOptimize: nodes.length > 50,
    },
  })

  const positions: Array<{ id: string; x: number; y: number }> = []
  graph.forEachNode((id, attrs) => {
    positions.push({ id, x: attrs.x as number, y: attrs.y as number })
  })

  self.postMessage({ key, positions })
}
