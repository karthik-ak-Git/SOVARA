import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { ensurePython, getPythonStatus } from '@/lib/server/app'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  try {
    return ok(await getPythonStatus())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load python status'))
  }
}

export async function POST() {
  try {
    return ok(await ensurePython())
  } catch (e) {
    return serverError(toErrorMessage(e, 'python setup failed'))
  }
}
