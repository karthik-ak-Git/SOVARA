import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { getLibraryDirectory, setLibraryDirectory } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getLibraryDirectory())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load library directory'))
  }
}

export async function POST(req: Request) {
  try {
    return ok(await setLibraryDirectory(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid library:setDirectory payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not change directory'))
  }
}
