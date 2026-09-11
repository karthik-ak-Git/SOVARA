import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { getModelFolder } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

/**
 * Resolves the trusted library folder for display. The web server has no
 * native file explorer to open (unlike Electron's shell.openPath).
 */
export async function POST(req: Request) {
  try {
    return ok(await getModelFolder(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not resolve model folder'))
  }
}
