import { subscribe } from '@/lib/server/events'

export const dynamic = 'force-dynamic'

/**
 * SSE push channel for model download progress (+ owned-runtime install
 * under modelId `__sovara_runtime__`). Replaces Electron's
 * `events:download` webContents broadcast.
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
      const unsubscribe = subscribe('download', (payload) => {
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
