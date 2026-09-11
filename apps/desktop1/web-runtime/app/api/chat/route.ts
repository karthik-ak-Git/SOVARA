import { badRequest, ok, serverError, readBody } from '@/lib/server/http'
import { sendChat } from '@/lib/server/chat'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Long-lived inference request: resolves when the durable assistant event
 * is persisted. Deltas stream on GET /api/chat/stream?sessionId= (SSE).
 * Same contract as the `chat:send` IPC invoke.
 */
export async function POST(req: Request) {
  try {
    return ok(await sendChat(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid chat payload: ${e.message}`)
    return serverError(e instanceof Error ? e.message : 'chat failed')
  }
}
