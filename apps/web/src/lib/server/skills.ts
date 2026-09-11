/**
 * Skills service — server-side boundary for skills sources + Bionic skills.
 * Same surface as the `skills:*` IPC handlers.
 */

import 'server-only'
import { zBionicSkillAdd, zBionicSkillId, zSkillImportFromUrl, zSkillsToggle } from '@shared/ipc/schemas'
import { getBackend } from './backend'

async function runtimeConfig() {
  return (await getBackend()) as unknown as {
    runtimeConfig: { getAppSetting: (k: string) => string | null; setAppSetting: (k: string, v: string) => void }
  }
}

export async function scanSources() {
  const { scanSkillsSources } = await import('@sovara-main/services/skillsScanner')
  return scanSkillsSources((await runtimeConfig()).runtimeConfig)
}

export async function toggleSource(raw: unknown) {
  const data = zSkillsToggle.parse(raw)
  const { setSkillsSourceEnabled } = await import('@sovara-main/services/skillsScanner')
  setSkillsSourceEnabled((await runtimeConfig()).runtimeConfig, data.sourceName, data.enabled)
  return { ok: true, sourceName: data.sourceName, enabled: data.enabled }
}

export async function listBionic() {
  const { listBionicSkills } = await import('@sovara-main/services/skillsScanner')
  return listBionicSkills()
}

export async function addBionic(raw: unknown) {
  const data = zBionicSkillAdd.parse(raw)
  const { createBionicSkill } = await import('@sovara-main/services/skillsScanner')
  return createBionicSkill(data)
}

export async function removeBionic(raw: unknown) {
  const data = zBionicSkillId.parse(raw)
  const { deleteBionicSkill } = await import('@sovara-main/services/skillsScanner')
  const ok = await deleteBionicSkill(data.id)
  if (!ok) throw new Error('skill not found')
  return { ok: true }
}

export async function listDetailed() {
  const { listDetailedSkillsForSources } = await import('@sovara-main/services/skillsScanner')
  return listDetailedSkillsForSources((await runtimeConfig()).runtimeConfig)
}

export async function importFromUrl(raw: unknown) {
  const data = zSkillImportFromUrl.parse(raw)
  const { importSkillFromUrl } = await import('@sovara-main/services/skillsScanner')
  return importSkillFromUrl(data.url)
}
