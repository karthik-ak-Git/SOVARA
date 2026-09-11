import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getVoiceStatus } from '@/lib/server/app'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getVoiceStatus())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load voice status'))
  }
}
