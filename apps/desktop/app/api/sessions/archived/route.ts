import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { listArchivedSessions } from '@/lib/server/sessions'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listArchivedSessions())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list archived sessions'))
  }
}
