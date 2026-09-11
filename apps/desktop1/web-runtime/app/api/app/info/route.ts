import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getInfo, getAppSystem } from '@/lib/server/app'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [info, system] = await Promise.all([getInfo(), getAppSystem()])
    return ok({ ...info, system })
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load app info'))
  }
}
