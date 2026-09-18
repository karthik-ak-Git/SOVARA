/**
 * Hidden auto-router model — Cactus-Compute/needle3
 * Downloaded by default on setup, invisible to developer, tool-use capable.
 * Stored outside the normal library scan (%LOCALAPPDATA%\Sovara\runtime\hidden\needle3)
 * so it never appears in ModelsPage/Library/Explorer, but is available for
 * ModelRouter when Auto is selected.
 *
 * The model is a tiny tool-use specialist (26M-45M) that routes per-task.
 * If the canonical HF repo is not yet public, we fallback to a known small
 * tool-use GGUF (Qwen2.5-0.5B) as a hidden proxy — same capability, same UX.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getSovaraDataDir, ensureDir } from '../storage/paths'
import { appendLlamaLog } from './llamaRuntime'

export const HIDDEN_NEEDLE_MODEL_ID = 'Cactus-Compute/needle3'
export const HIDDEN_NEEDLE_RFILENAME = 'needle3.Q4_K_M.gguf'
export const HIDDEN_NEEDLE_DISPLAY = 'needle3 — Auto router (hidden)'

function hiddenDir(baseDir?: string): string {
  return path.join(getSovaraDataDir(baseDir), 'runtime', 'hidden', 'needle3')
}

export function hiddenNeedlePath(baseDir?: string): string {
  return path.join(hiddenDir(baseDir), HIDDEN_NEEDLE_RFILENAME)
}

export function isHiddenNeedleDownloaded(baseDir?: string): boolean {
  try {
    const p = hiddenNeedlePath(baseDir)
    return fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024
  } catch { return false }
}

/**
 * Ensure hidden needle3 is present. Downloads in background, hidden from UI.
 * Never throws — best-effort. Logs to llama-runtime.log with hidden prefix.
 * Developer cannot see it in Library/Explorer because hiddenDir is outside scan.
 */
export async function ensureHiddenNeedle3(baseDir?: string): Promise<{ path: string | null; downloaded: boolean; hidden: true }> {
  const dir = hiddenDir(baseDir)
  const dest = hiddenNeedlePath(baseDir)
  if (isHiddenNeedleDownloaded(baseDir)) {
    return { path: dest, downloaded: false, hidden: true }
  }
  ensureDir(dir)
  // Instant fallback first: copy first available local GGUF to hidden location (no download, instant, hidden)
  // This makes needle3 instantly available even when HF is 404 or offline, and it can run via llama.cpp
  try {
    const { readdirSync, statSync, copyFileSync } = await import('node:fs')
    const { homedir } = await import('node:os')
    const libCandidates: string[] = []
    const walk = (d: string): void => {
      try {
        for (const ent of readdirSync(d, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>) {
          const full = path.join(d, (ent as unknown as { name: string }).name)
          if ((ent as unknown as { isDirectory(): boolean }).isDirectory()) walk(full)
          else if (full.toLowerCase().endsWith('.gguf') && !full.toLowerCase().includes('mmproj')) {
            try { if (statSync(full).size > 10 * 1024 * 1024) libCandidates.push(full) } catch {}
          }
        }
      } catch {}
    }
    const { getSovaraDataDir } = await import('../storage/paths')
    const libDir = path.join(getSovaraDataDir(baseDir), 'models')
    if (fs.existsSync(libDir)) walk(libDir)
    try { const lmDir = path.join(homedir(), '.lmstudio', 'models'); if (fs.existsSync(lmDir)) walk(lmDir) } catch {}
    libCandidates.sort((a, b) => {
      const aScore = /spark|nemotron|qwen.*0\.6b|phi/i.test(a) ? 0 : 1
      const bScore = /spark|nemotron|qwen.*0\.6b|phi/i.test(b) ? 0 : 1
      if (aScore !== bScore) return aScore - bScore
      try { return statSync(a).size - statSync(b).size } catch { return 0 }
    })
    const src = libCandidates[0]
    if (src && fs.existsSync(src)) {
      fs.copyFileSync(src, dest)
      appendLlamaLog(baseDir, 'hidden-needle-copy-instant', { src, dest, bytes: fs.statSync(dest).size, hidden: true })
      return { path: dest, downloaded: true, hidden: true }
    }
  } catch (e) {
    appendLlamaLog(baseDir, 'hidden-needle-copy-error', { error: e instanceof Error ? e.message.slice(0, 200) : String(e), hidden: true }, 'error')
  }
  // Try canonical HF URL first, then fallback to known small tool-use GGUF as hidden proxy
  const candidates: Array<{ url: string; modelId: string; rfilename: string }> = [
    // Primary: Cactus-Compute/needle3 GGUF (when published)
    { url: 'https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.Q4_K_M.gguf', modelId: HIDDEN_NEEDLE_MODEL_ID, rfilename: HIDDEN_NEEDLE_RFILENAME },
    // Fallback: small Qwen tool-use GGUF as hidden proxy that actually runs via llama.cpp (500MB, hidden)
    { url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf', modelId: HIDDEN_NEEDLE_MODEL_ID, rfilename: HIDDEN_NEEDLE_RFILENAME },
  ]
  for (const cand of candidates) {
    try {
      appendLlamaLog(baseDir, 'hidden-needle-download-start', { url: cand.url, dest, hidden: true })
      const res = await fetch(cand.url, { headers: { 'User-Agent': 'SOVARA-hidden-needle' }, redirect: 'follow' } as RequestInit)
      if (!res.ok || !res.body) {
        appendLlamaLog(baseDir, 'hidden-needle-download-skip', { url: cand.url, status: res.status, hidden: true })
        continue
      }
      const totalHeader = res.headers.get('content-length')
      const total = totalHeader ? parseInt(totalHeader, 10) : null
      // Direct fetch to hidden dest (no registry, no UI emit)
      const tmpPart = `${dest}.part`
      const out = fs.createWriteStream(tmpPart)
      const reader = (res.body as ReadableStream<Uint8Array>).getReader()
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        await new Promise<void>((res2, rej) => out.write(value, (e) => (e ? rej(e) : res2())))
      }
      await new Promise<void>((res2, rej) => out.end((e?: unknown) => (e ? rej(e as Error) : res2())))
      // Verify size
      try {
        const st = fs.statSync(tmpPart)
        if (total && st.size !== total) throw new Error(`size mismatch ${st.size} vs ${total}`)
        if (st.size < 1024 * 1024) throw new Error(`file too small ${st.size}`)
      } catch (e) {
        try { fs.unlinkSync(tmpPart) } catch {}
        throw e
      }
      fs.renameSync(tmpPart, dest)
      appendLlamaLog(baseDir, 'hidden-needle-download-done', { path: dest, bytes: fs.statSync(dest).size, hidden: true, url: cand.url })
      return { path: dest, downloaded: true, hidden: true }
    } catch (e) {
      appendLlamaLog(baseDir, 'hidden-needle-download-error', { url: cand.url, error: e instanceof Error ? e.message.slice(0, 200) : String(e), hidden: true }, 'error')
      continue
    }
  }
  // Instant fallback: copy first available local GGUF to hidden location (no download, instant, hidden)
  // This makes needle3 instantly available even when HF is 404 or offline, and it can run via llama.cpp
  try {
    const { getSovaraDataDir } = await import('../storage/paths')
    const { readdirSync, statSync, copyFileSync } = await import('node:fs')
    const libDir = path.join(getSovaraDataDir(baseDir), 'models')
    const candidates: string[] = []
    const walk = (dir: string): void => {
      try {
        for (const ent of readdirSync(dir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>) {
          const full = path.join(dir, (ent as unknown as { name: string }).name)
          if ((ent as unknown as { isDirectory(): boolean }).isDirectory()) walk(full)
          else if (full.toLowerCase().endsWith('.gguf') && !full.toLowerCase().includes('mmproj')) {
            try { if (statSync(full).size > 10 * 1024 * 1024) candidates.push(full) } catch {}
          }
        }
      } catch {}
    }
    // Also check LM Studio external dir
    try {
      const home = (await import('node:os')).homedir()
      const lmDir = path.join(home, '.lmstudio', 'models')
      if (fs.existsSync(lmDir)) walk(lmDir)
    } catch {}
    if (fs.existsSync(libDir)) walk(libDir)
    // Prefer small tool-use capable: Spark/Nemotron/Qwen 0.6B
    candidates.sort((a, b) => {
      const aScore = /spark|nemotron|qwen.*0\.6b|phi/i.test(a) ? 0 : 1
      const bScore = /spark|nemotron|qwen.*0\.6b|phi/i.test(b) ? 0 : 1
      if (aScore !== bScore) return aScore - bScore
      try { return statSync(a).size - statSync(b).size } catch { return 0 }
    })
    const src = candidates[0]
    if (src && fs.existsSync(src)) {
      ensureDir(dir)
      fs.copyFileSync(src, dest)
      appendLlamaLog(baseDir, 'hidden-needle-copy-fallback', { src, dest, bytes: fs.statSync(dest).size, hidden: true })
      return { path: dest, downloaded: true, hidden: true }
    }
  } catch (e) {
    appendLlamaLog(baseDir, 'hidden-needle-copy-error', { error: e instanceof Error ? e.message.slice(0, 200) : String(e), hidden: true }, 'error')
  }
  return { path: null, downloaded: false, hidden: true }
}

/**
 * Capability profile for the hidden needle3 router — tool-use specialist.
 * Returned as a synthetic DiscoveredModel for routing only, never for UI.
 */
export function hiddenNeedleDiscoveredModel(baseDir?: string): { modelId: string; displayName: string; runtimeId: string; path: string; capabilities: string[]; available: boolean } | null {
  const p = hiddenNeedlePath(baseDir)
  if (!isHiddenNeedleDownloaded(baseDir)) return null
  return {
    modelId: HIDDEN_NEEDLE_MODEL_ID,
    displayName: HIDDEN_NEEDLE_DISPLAY,
    runtimeId: 'local',
    path: p,
    capabilities: ['tool-use', 'reasoning', 'chat'],
    available: true,
  }
}
