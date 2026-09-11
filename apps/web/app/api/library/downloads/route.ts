import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getActiveDownloads } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getActiveDownloads())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load active downloads'))
  }
}
