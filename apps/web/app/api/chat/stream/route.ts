import { subscribeSession } from '@/lib/server/events'
import type { ChatStreamEvent } from '@shared/types/chat'

export const dynamic = 'force-dynamic'

/**
 * SSE push channel for transient chat stream events (deltas, orchestration
 * states, completion). Replaces Electron's `events:session` webContents
 * broadcast. One stream per session: GET /api/chat/stream?sessionId=<id>.
 * Deltas are transient and never persisted server-side (IPC parity).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId') ?? ''

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // client disconnected
        }
      }
      // Heartbeat comment keeps intermediaries from closing idle streams.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          // client disconnected
        }
      }, 25000)
      const unsubscribe = sessionId
        ? subscribeSession(sessionId, (ev: ChatStreamEvent) => send(ev))
        : () => {}
      const close = (): void => {
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      req.signal.addEventListener('abort', close)
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
