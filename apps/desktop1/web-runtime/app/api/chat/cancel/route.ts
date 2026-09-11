import { badRequest, ok, serverError, readBody } from '@/lib/server/http'
import { cancelChat } from '@/lib/server/chat'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await cancelChat(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid cancel payload: ${e.message}`)
    return serverError(e instanceof Error ? e.message : 'cancel failed')
  }
}
