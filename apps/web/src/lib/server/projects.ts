/**
 * Project service — server-side boundary for project-scoped chats.
 * Delegates 1:1 to the persistence port (same as `projects:*` IPC handlers).
 */

import 'server-only'
import { zProjectCreate, zProjectId, zProjectRename } from '@shared/ipc/schemas'
import { getBackend } from './backend'

export async function listProjects() {
  return (await getBackend()).ports.persistence.listProjects()
}

export async function createProject(raw: unknown) {
  const data = zProjectCreate.parse(raw)
  return (await getBackend()).ports.persistence.createProject(data.name, data.rootPath)
}

export async function renameProject(raw: unknown) {
  const data = zProjectRename.parse(raw)
  return (await getBackend()).ports.persistence.renameProject(data.projectId, data.name)
}

export async function deleteProject(raw: unknown) {
  const data = zProjectId.parse(raw)
  await (await getBackend()).ports.persistence.deleteProject(data.projectId)
  return { ok: true }
}
