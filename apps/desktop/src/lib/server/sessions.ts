/**
 * Session service — server-side boundary for chat session persistence.
 * Delegates 1:1 to the persistence port owned by AppBackend (SQLite+JSONL).
 * Same validation (shared Zod schemas) and same return shapes as the
 * `sessions:*` IPC handlers.
 */

import 'server-only'
import { brand } from '@shared/types/branded'
import {
  zSessionArchive,
  zSessionId,
  zSessionRename,
  zSessionsCreate,
} from '@shared/ipc/schemas'
import { getBackend } from './backend'

export async function listSessions() {
  return (await getBackend()).ports.persistence.list()
}

export async function listArchivedSessions() {
  return (await getBackend()).ports.persistence.listArchived()
}

export async function getSession(sessionId: string) {
  const id = zSessionId.parse(sessionId)
  return (await getBackend()).ports.persistence.get(brand<'SessionId'>(id))
}

export async function createSession(raw: unknown) {
  const data = zSessionsCreate.parse(raw ?? {})
  return (await getBackend()).ports.persistence.create(data.title, data.projectId ?? null)
}

export async function renameSession(raw: unknown) {
  const data = zSessionRename.parse(raw)
  return (await getBackend()).ports.persistence.rename(
    brand<'SessionId'>(data.sessionId),
    data.title
  )
}

export async function deleteSession(sessionId: string) {
  const id = zSessionId.parse(sessionId)
  await (await getBackend()).ports.persistence.deletePermanently(brand<'SessionId'>(id))
  return { ok: true }
}

export async function archiveSession(raw: unknown) {
  const data = zSessionArchive.parse(raw)
  await (await getBackend()).ports.persistence.archive(brand<'SessionId'>(data.sessionId))
  return { ok: true }
}

export async function unarchiveSession(raw: unknown) {
  const data = zSessionArchive.parse(raw)
  await (await getBackend()).ports.persistence.unarchive(brand<'SessionId'>(data.sessionId))
  return { ok: true }
}

export async function getSessionEvents(sessionId: string) {
  const id = zSessionId.parse(sessionId)
  return (await getBackend()).ports.persistence.getEvents(brand<'SessionId'>(id))
}
