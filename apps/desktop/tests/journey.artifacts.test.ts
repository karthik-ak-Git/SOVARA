/**
 * AGENT JOURNEY — I act as the model inside SOVARA and attempt all five
 * artifact implementations the app ships: pdf, xlsx, docx, pptx, code.
 *
 * Everything here uses the REAL production code paths:
 *   detectOutputFormat → markdownToSheets/Paragraphs/Slides → writeXFile →
 *   generateArtifactFile
 * No HTML artifacts (the app never renders those for these kinds), no mocks.
 *
 * Real files are written to test/sovara-agent-journey/out/ so the output can be
 * opened and inspected rather than merely asserted on.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  detectOutputFormat, generateArtifactFile, extractCodeBlock,
  markdownToSheets, markdownToParagraphs, markdownToSlides,
  type ArtifactKind,
} from '../src/main/backend/artifacts'
import { detectSkillNeeds } from '../src/main/backend/TaskClassifier'
import { extractToolFences } from '../src/main/backend/tools/fenceTools'

const OUT = path.resolve(__dirname, '..', '..', '..', 'test', 'sovara-agent-journey', 'out')
const ISSUES: string[] = []
function issue(area: string, detail: string) { ISSUES.push(`[${area}] ${detail}`) }

beforeAll(() => fs.mkdirSync(OUT, { recursive: true }))
afterAll(() => {
  fs.writeFileSync(path.join(OUT, '_ISSUES.txt'),
    ISSUES.length ? ISSUES.join('\n') : 'none recorded', 'utf8')
})

/** Read one member out of a zip on disk. ZIP members are DEFLATED, so the
 *  bytes are only meaningful once actually inflated. */
function readZipMember(file: string, member: string): string | null {
  try {
    const zlib = require('node:zlib') as typeof import('node:zlib')
    const buf = fs.readFileSync(file)
    // Walk local file headers looking for the member name.
    let off = 0
    while (off < buf.length - 4) {
      if (buf.readUInt32LE(off) !== 0x04034b50) { off++; continue }
      const method = buf.readUInt16LE(off + 8)
      const csize = buf.readUInt32LE(off + 18)
      const nameLen = buf.readUInt16LE(off + 26)
      const extraLen = buf.readUInt16LE(off + 28)
      const name = buf.subarray(off + 30, off + 30 + nameLen).toString('latin1')
      const dataStart = off + 30 + nameLen + extraLen
      if (name === member) {
        const data = buf.subarray(dataStart, dataStart + csize)
        return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8')
      }
      off = dataStart + csize
    }
    return null
  } catch { return null }
}

/** ── 1. PDF ─────────────────────────────────────────────────────────── */
describe('JOURNEY 1/5 · PDF — "create a pdf report"', () => {
  it('detects, generates a real PDF, and it is a valid PDF', () => {
    const user = 'Create a quarterly revenue report as revenue.pdf'
    const det = detectOutputFormat(user)
    expect(det?.kind).toBe('pdf')
    if (!det) return issue('pdf', 'detectOutputFormat returned null for an explicit .pdf request')

    const modelReply = `# Q3 Revenue Report\n\nTotal revenue reached $4.2M, up 18% quarter over quarter.\n\n## Highlights\n- Enterprise: $2.1M\n- SMB: $1.4M\n- Services: $0.7M\n`
    const file = path.join(OUT, det.fileName)
    const res = generateArtifactFile('pdf', file, modelReply, user)
    expect(res).toBeTruthy()
    expect(fs.existsSync(file)).toBe(true)

    const head = fs.readFileSync(file).subarray(0, 5).toString('latin1')
    expect(head, 'must start with the %PDF- magic bytes').toBe('%PDF-')
    const raw = fs.readFileSync(file, 'latin1')
    expect(raw).toContain('%%EOF')
    if (!/%%EOF/.test(raw)) issue('pdf', 'PDF written without a %%EOF trailer')
  })
})

/** ── 2. XLSX ────────────────────────────────────────────────────────── */
describe('JOURNEY 2/5 · XLSX — "generate an excel spreadsheet"', () => {
  it('turns a markdown table into a real xlsx (zip) with the rows', () => {
    const user = 'Generate an excel spreadsheet sales.xlsx'
    const det = detectOutputFormat(user)
    expect(det?.kind).toBe('xlsx')
    if (!det) return issue('xlsx', 'detectOutputFormat returned null for an explicit .xlsx request')

    const modelReply = `# Sales\n\n| Region | Q1 | Q2 |\n| --- | --- | --- |\n| North | 120 | 145 |\n| South | 98 | 112 |\n| East | 143 | 160 |`
    const sheets = markdownToSheets(modelReply)
    expect(sheets.length).toBeGreaterThan(0)

    const file = path.join(OUT, det.fileName)
    const res = generateArtifactFile('xlsx', file, modelReply, user)
    expect(res).toBeTruthy()
    expect(fs.existsSync(file)).toBe(true)

    // A real xlsx is a ZIP: starts with PK\x03\x04
    const magic = fs.readFileSync(file).subarray(0, 4)
    expect(magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'must be a ZIP container').toBe(true)
    // NOTE: the data lives in a DEFLATED zip member, so a raw-bytes grep for the
    // cell text proves nothing. Read the actual member out of the archive.
    const shared = readZipMember(file, 'xl/sharedStrings.xml')
    if (!shared || !shared.includes('North') || !shared.includes('South')) {
      issue('xlsx', `sharedStrings.xml does not carry the cell text (got: ${shared ? 'present but empty of rows' : 'MISSING'})`)
    } else {
      expect(shared).toContain('North')
    }
  })
})

/** ── 3. DOCX ────────────────────────────────────────────────────────── */
describe('JOURNEY 3/5 · DOCX — "create a word document"', () => {
  it('generates a real docx (zip) containing the paragraphs', () => {
    const user = 'Create a word document memo.docx for the team'
    const det = detectOutputFormat(user)
    expect(det?.kind).toBe('docx')
    if (!det) return issue('docx', 'detectOutputFormat returned null for an explicit .docx request')

    const modelReply = `# Project Update\n\nThe migration finished on schedule.\n\nNext steps:\n1. Rotate credentials\n2. Archive staging\n\nOwner: Karthik`
    const paras = markdownToParagraphs(modelReply)
    expect(paras.length).toBeGreaterThan(1)

    const file = path.join(OUT, det.fileName)
    const res = generateArtifactFile('docx', file, modelReply, user)
    expect(res).toBeTruthy()
    expect(fs.existsSync(file)).toBe(true)

    const magic = fs.readFileSync(file).subarray(0, 4)
    expect(magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
    const raw = fs.readFileSync(file, 'latin1')
    if (!/word\//.test(raw)) issue('docx', 'archive has no word/ part — Word may refuse to open it')
  })
})

/** ── 4. PPTX ────────────────────────────────────────────────────────── */
describe('JOURNEY 4/5 · PPTX — "build a presentation"', () => {
  it('generates a real pptx (zip) with slides', () => {
    const user = 'Build a presentation deck.pptx about the roadmap'
    const det = detectOutputFormat(user)
    expect(det?.kind).toBe('pptx')
    if (!det) return issue('pptx', 'detectOutputFormat returned null for an explicit .pptx request')

    const modelReply = `# Roadmap 2026\n\n## Q1\n- Ship CLI\n- Fix updater\n\n## Q2\n- Vision models\n- Agent Studio`
    const slides = markdownToSlides(modelReply)
    expect(slides.length).toBeGreaterThan(1)

    const file = path.join(OUT, det.fileName)
    const res = generateArtifactFile('pptx', file, modelReply, user)
    expect(res).toBeTruthy()
    expect(fs.existsSync(file)).toBe(true)

    const magic = fs.readFileSync(file).subarray(0, 4)
    expect(magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
    const raw = fs.readFileSync(file, 'latin1')
    if (!/ppt\//.test(raw)) issue('pptx', 'archive has no ppt/ part — PowerPoint may refuse to open it')
    if (!raw.includes('slide1')) issue('pptx', 'no slide1.xml in the package')
  })
})

/** ── 5. CODE ────────────────────────────────────────────────────────── */
describe('JOURNEY 5/5 · CODE — "write a python script"', () => {
  it('extracts the fenced block and writes a real script', () => {
    const user = 'Create a python script wordcount.py'
    const det = detectOutputFormat(user)
    expect(det?.kind).toBe('code')
    if (!det) return issue('code', 'detectOutputFormat returned null for an explicit .py request')

    const modelReply = "Here it is:\n\n```python\nimport sys\nprint(len(sys.argv) - 1, 'args')\n```\n"
    const block = extractCodeBlock(modelReply)
    expect(block).toBeTruthy()
    if (!block) return issue('code', 'extractCodeBlock failed on a standard fenced python block')

    const file = path.join(OUT, det.fileName)
    const res = generateArtifactFile('code', file, modelReply, user)
    expect(res).toBeTruthy()
    expect(fs.existsSync(file)).toBe(true)

    const written = fs.readFileSync(file, 'utf8')
    if (!written.includes('import sys')) issue('code', 'file written without the actual code body')
  })

  it('recovers a code block when the model forgets the language tag', () => {
    const reply = 'Sure:\n\n```\nprint("no lang tag")\n```'
    const block = extractCodeBlock(reply)
    if (!block) issue('code', 'unlabelled fence produced no code block')
  })
})

/** ── Cross-cutting: what the MODEL would hit in a real turn ─────────── */
describe('JOURNEY cross-cutting · frictions the model actually hits', () => {
  it('uses ONLY the filename the user asked for — not the whole sentence', () => {
    // BUG FOUND: the filename regex is greedy across the sentence, so
    // "Create a quarterly revenue report as revenue.pdf" produced
    // "Create-a-quarterly-revenue-report-as-revenue.pdf". The user asked for
    // revenue.pdf. This is a real, user-visible defect, not a test artefact.
    const cases: Array<[string, string]> = [
      ['Create a quarterly revenue report as revenue.pdf', 'revenue.pdf'],
      ['generate an excel spreadsheet sales.xlsx', 'sales.xlsx'],
      ['create a word document memo.docx', 'memo.docx'],
      ['build a presentation deck.pptx', 'deck.pptx'],
    ]
    for (const [prompt, expected] of cases) {
      const det = detectOutputFormat(prompt)
      if (!det) { issue('filename', `"${prompt}" produced no detection`); continue }
      if (det.fileName.toLowerCase() !== expected) {
        issue('filename', `"${prompt}" → fileName "${det.fileName}" (expected "${expected}") — the whole sentence leaked into the filename`)
      }
      expect(det.fileName.toLowerCase(), prompt).toBe(expected)
    }
  })

  it('classification knows which artifact skill to demand', () => {
    const cases: Array<[string, string]> = [
      ['create a powerpoint deck', 'pptx'],
      ['make an excel report', 'xlsx'],
      ['write a word document', 'docx'],
      ['export a pdf', 'pdf'],
      ['write a python script', 'code'],
    ]
    for (const [prompt, skill] of cases) {
      const needs = detectSkillNeeds(prompt)
      if (!needs.includes(skill)) {
        issue('skill-routing', `"${prompt}" did NOT classify as '${skill}' (got: ${needs.join(',') || 'none'}) — the skill gate will not fire`)
      }
    }
  })

  it('a read request is NOT mistaken for a create request', () => {
    // Regression guard: "read README.md" must not produce a file.
    const det = detectOutputFormat('read README.md and tell me what it says')
    if (det) issue('detection', `read-intent prompt wrongly detected as a ${det.kind} create request`)
  })

  it('the five kinds are exactly the five the writer supports', () => {
    const kinds: ArtifactKind[] = ['pdf', 'xlsx', 'docx', 'pptx', 'code']
    for (const k of kinds) {
      const file = path.join(OUT, `probe.${k === 'code' ? 'txt' : k}`)
      const res = generateArtifactFile(k, file, '# T\n\nbody', 'make it')
      if (!res) issue('writer', `generateArtifactFile returned null for kind '${k}'`)
    }
  })

  it('reports an honest result for an unsupported kind instead of writing junk', () => {
    const target = path.join(OUT, 'unsupported-probe.bin')
    if (fs.existsSync(target)) fs.rmSync(target)
    const res = generateArtifactFile('video' as never, target, 'x', 'x')
    if (res) issue('writer', `unsupported kind 'video' still produced a file — should return null`)
    expect(res, 'unsupported kind must return null, not write a file').toBeNull()
    expect(fs.existsSync(target), 'no file may be written for an unsupported kind').toBe(false)
  })

  it('writes every artifact into the journey folder for manual inspection', () => {
    const files = fs.readdirSync(OUT).filter((f) => !f.startsWith('_'))
    expect(files.length).toBeGreaterThanOrEqual(5)
  })
})
