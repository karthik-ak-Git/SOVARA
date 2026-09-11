import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getFullHardwareProfile } from '@/lib/server/hardware'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getFullHardwareProfile())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not build hardware profile'))
  }
}
