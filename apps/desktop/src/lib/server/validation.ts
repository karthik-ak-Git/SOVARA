/**
 * Validation service — server-side boundary for hardware/model validation
 * jobs (DETECT→PROFILE→ESTIMATE→PRE→LOAD→INFER→MEASURE→VALIDATE).
 * Same surface as the `validation:*` IPC handlers.
 */

import 'server-only'
import { zValidationGet, zValidationStart } from '@shared/ipc/schemas'
import { getBackend } from './backend'

export async function startValidation(raw: unknown) {
  const data = zValidationStart.parse(raw)
  return (await getBackend()).startValidation(data.modelId, data.libraryPath, data.ctxLen)
}

export async function getValidation(raw: unknown) {
  const data = zValidationGet.parse(raw)
  const job = (await getBackend()).getValidation(data.jobId)
  if (!job) throw new Error('unknown job')
  return job
}

export async function listValidations() {
  return (await getBackend()).listValidations()
}

export async function listValidationCache() {
  return (await getBackend()).listValidationCache()
}
