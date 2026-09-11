import { subscribe } from '@/lib/server/events'

export const dynamic = 'force-dynamic'

/**
 * SSE push channel for runtime instance changes. The current backend emits
 * no instance pushes (parity with Electron, where the subscription is
 * dormant) — the connection stays open with heartbeats so future pushes
 * flow without client changes.
 */
export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          // client disconnected
        }
      }, 25000)
      const unsubscribe = subscribe('instances', (payload) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          // client disconnected
        }
      })
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
