import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { getSettings, setSettings } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getSettings())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load settings'))
  }
}

export async function PATCH(req: Request) {
  try {
    return ok(await setSettings(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid settings payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not save settings'))
  }
}
