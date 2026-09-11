import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { listLocalModels } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listLocalModels())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list local models'))
  }
}
