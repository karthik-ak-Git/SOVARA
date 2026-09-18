/**
 * Unlimited Context — virtual memory for attention (Aether + Cognitive Workspace).
 * Resident window stays 8192 (llama-server -c 8192). Overflow encoded to disk pool,
 * recovered as one curated slice injected before generation.
 * No summarization loss — encode & recover, not compress & forget.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const POOL_DIR_NAME = 'context-pool'
const SLICE_CHARS = 1800 // ~450 tok per slice, 3-4 slices per inject = ~1500 tok curated
const MAX_POOL_MB_DEFAULT = 512 // 0.5 GB pool ≈ 116M tokens reach (floor scaled for desktop)
const INDEX_NAME = 'index.json'

interface Slice { id: string; text: string; role: string; ts: number; tokens: number }
interface IndexFile { slices: Slice[]; totalChars: number }

function poolDir(baseDir?: string): string | null {
  if (!baseDir) return null
  return path.join(baseDir, POOL_DIR_NAME)
}
function indexPath(baseDir?: string): string | null {
  const d = poolDir(baseDir)
  return d ? path.join(d, INDEX_NAME) : null
}
function ensurePool(baseDir?: string): string | null {
  const d = poolDir(baseDir)
  if (!d) return null
  try { fs.mkdirSync(d, { recursive: true }) } catch {}
  return d
}
function loadIndex(baseDir?: string): IndexFile {
  const p = indexPath(baseDir)
  if (!p || !fs.existsSync(p)) return { slices: [], totalChars: 0 }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as IndexFile } catch { return { slices: [], totalChars: 0 } }
}
function saveIndex(baseDir: string | undefined, idx: IndexFile): void {
  const p = indexPath(baseDir)
  if (!p) return
  ensurePool(baseDir)
  // retention: keep file < MAX_POOL_MB_DEFAULT, drop oldest slices first (fade stale)
  let maxChars = MAX_POOL_MB_DEFAULT * 1024 * 1024
  let curChars = idx.totalChars
  while (curChars > maxChars && idx.slices.length > 1) {
    const dropped = idx.slices.shift()!
    curChars -= dropped.text.length
  }
  idx.totalChars = curChars
  try { fs.writeFileSync(p!, JSON.stringify(idx), 'utf8') } catch {}
}

export function encodeToPool(baseDir: string | undefined, sessionId: string, olderTurns: Array<{ role: string; content: string }>): number {
  if (!baseDir || olderTurns.length === 0) return 0
  const idx = loadIndex(baseDir)
  let added = 0
  for (const t of olderTurns) {
    // chunk long content into slices
    const chunks = chunkText(t.content, SLICE_CHARS)
    for (const ch of chunks) {
      const s: Slice = { id: crypto.randomUUID().slice(0,8), text: `[${sessionId.slice(-6)}] ${t.role}: ${ch}`, role: t.role, ts: Date.now(), tokens: Math.ceil(ch.length/4) }
      idx.slices.push(s)
      idx.totalChars += s.text.length
      added++
    }
  }
  saveIndex(baseDir, idx)
  return added
}

function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text]
  const out: string[] = []
  for (let i=0;i<text.length;i+=size) out.push(text.slice(i, i+size))
  return out
}

// MPO-style chain: cosine-like keyword overlap + adjacency pulls connected thread
function scoreSlice(query: string, slice: Slice, neighborBonus: Map<string, number>): number {
  const qWords = new Set(query.toLowerCase().split(/\W+/).filter(w=>w.length>3))
  const sWords = slice.text.toLowerCase().split(/\W+/)
  let hits = 0
  for (const w of sWords) if (qWords.has(w)) hits++
  let score = hits / Math.max(1, qWords.size)
  // recency boost (working buffer) + neighbor chain boost (episodic)
  const ageHours = (Date.now() - slice.ts) / 3600000
  score += Math.max(0, 0.15 - ageHours*0.01)
  score += neighborBonus.get(slice.id) ?? 0
  return score
}

export function retrieveSlice(baseDir: string | undefined, query: string, budgetChars = 2400): string | null {
  if (!baseDir) return null
  const idx = loadIndex(baseDir)
  if (idx.slices.length === 0) return null
  // first pass: score
  const scored = idx.slices.map((s,i) => ({ s, i, score: 0 }))
  const baseScores = scored.map(o => ({ ...o, score: scoreSlice(query, o.s, new Map()) }))
  baseScores.sort((a,b)=>b.score-a.score)
  const topIds = new Set(baseScores.slice(0,3).map(o=>o.s.id))
  // MPO chain: neighbors of top get bonus
  const bonus = new Map<string,number>()
  for (const o of scored) {
    if (topIds.has(o.s.id)) continue
    // adjacency = within 2 slices of a top slice
    const nearTop = baseScores.slice(0,3).some(t => Math.abs(t.i - o.i) <= 2)
    if (nearTop) bonus.set(o.s.id, 0.25)
  }
  const rescored = scored.map(o => ({ ...o, score: scoreSlice(query, o.s, bonus) }))
  rescored.sort((a,b)=>b.score-a.score)
  // pick top slices that fit budget, preserving original order (thread)
  const picked = rescored.slice(0,5).filter(o=>o.score>0.05).sort((a,b)=>a.i-b.i)
  if (picked.length===0) return null
  let out = ''
  for (const p of picked) {
    if (out.length + p.s.text.length + 2 > budgetChars) break
    out += (out ? '\n' : '') + p.s.text
  }
  return out ? `Recovered context (pool ${idx.slices.length} slices, ~${Math.round(idx.totalChars/4/1000)}k tok reach):\n${out}` : null
}

export function poolStats(baseDir?: string): { slices: number; reachTokens: number; poolMB: number } | null {
  if (!baseDir) return null
  const idx = loadIndex(baseDir)
  return { slices: idx.slices.length, reachTokens: Math.round(idx.totalChars/4), poolMB: Math.round(idx.totalChars/1024/1024*100)/100 }
}
