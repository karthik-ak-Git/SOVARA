import { badRequest, ok, serverError, readBody } from '@/lib/server/http'
import { regenerateChat } from '@/lib/server/chat'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    return ok(await regenerateChat(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid regenerate payload: ${e.message}`)
    return serverError(e instanceof Error ? e.message : 'regenerate failed')
  }
}
