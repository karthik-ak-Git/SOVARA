import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { dispatchTool } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await dispatchTool(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid tools:dispatch payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'tool dispatch failed'))
  }
}
