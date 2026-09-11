import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { transcribe } from '@/lib/server/app'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    return ok(await transcribe(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid voice:transcribe payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'transcription failed'))
  }
}
