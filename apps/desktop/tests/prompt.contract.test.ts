/**
 * SYSTEM-PROMPT CONTRACT
 *
 * The old prompt forbade the only method that produces professional output
 * ("Do not create or run a Python script"), while the runtime tool catalog
 * advertised the opposite ("Use shell_exec for running python"). The model was
 * given contradictory orders, so skill-following was non-deterministic and the
 * hardcoded writers became the destination.
 *
 * Reference: test/system_prompts_leaks/Meta/meta-spark.md — Meta's own prompt
 * for this same model family. It grants python-pptx, python-docx, reportlab,
 * openpyxl, matplotlib and pillow, and describes tools by capability with
 * usage rules rather than prohibitions.
 *
 * These assertions are prompt-level contracts. If a future edit reintroduces a
 * prohibition, or drops the output contract, this file fails.
 */
import { describe, it, expect } from 'vitest'
import { SOVARA_SYSTEM_PROMPT } from '../src/main/backend/prompts/sovaraSystem'

const P = SOVARA_SYSTEM_PROMPT

describe('prompt contract · no prohibitions on the winning method', () => {
  it.each([
    ['do not create or run a python script', /do not create or run a python script/i],
    ['never require a Python runtime', /never require a python runtime/i],
    ['materializes binary artifacts locally', /materializes binary artifacts locally/i],
    ['prefer TypeScript/React as a blanket rule', /prefer typescript\/react workflows/i],
  ])('does not contain: %s', (_label, re) => {
    expect(P, `prompt still contains banned phrase: ${_label}`).not.toMatch(re)
  })

  it('tells the model to build the file itself', () => {
    expect(P).toMatch(/BUILD IT YOURSELF/i)
    expect(P).toMatch(/run it with shell_exec/i)
    expect(P).toMatch(/built-in writers are a\s+FALLBACK/i)
  })

  it('does not contradict the runtime tool catalog', () => {
    // The catalog advertises shell_exec for python; the prompt must not forbid it.
    expect(P).not.toMatch(/\bnever\b[^.]*\bpython\b/i)
    expect(P).not.toMatch(/\bdo not\b[^.]*\bpython\b/i)
  })
})

describe('prompt contract · skill routing is reachable', () => {
  it('instructs a single-keyword search, not a multi-word phrase', () => {
    expect(P).toMatch(/ONE short keyword/i)
    // The old prompt taught "pptx presentation" — 0 hits against 1268 skills.
    expect(P).not.toMatch(/query e\.g\. "pptx presentation"/i)
    expect(P).not.toMatch(/"xlsx excel"/i)
  })

  it('tells the model to retry rather than give up on one query', () => {
    expect(P).toMatch(/retry with ONE different keyword/i)
    expect(P).toMatch(/Never conclude "no skill exists"/i)
  })

  it('names the real installed skills by example', () => {
    for (const kw of ['pptx', 'xlsx', 'docx', 'pdf', 'slides', 'chart']) {
      expect(P, `prompt never mentions the "${kw}" keyword`).toContain(kw)
    }
  })
})

describe('prompt contract · honesty about results', () => {
  it('requires observing the file before claiming it', () => {
    expect(P).toMatch(/Only claim a file was created if you observed it/i)
    expect(P).toMatch(/never describe a file that does not exist/i)
  })

  it('forbids inventing data when none was supplied', () => {
    expect(P).toMatch(/NO DATA, NO INVENTIONS/i)
    expect(P).toMatch(/illustrative placeholder/i)
  })

  it('forbids filler titles', () => {
    expect(P).toMatch(/never a filler placeholder/i)
    expect(P).toContain('Key point overview')
  })
})

describe('prompt contract · output is machine-parseable', () => {
  it('requires tables for structured data, with header separators', () => {
    expect(P).toMatch(/markdown TABLE/i)
    expect(P).toMatch(/header separator row/i)
    expect(P).toMatch(/\| --- \|/)
  })

  it('requires flat bullets only', () => {
    expect(P).toMatch(/flat bullets/i)
    expect(P).toMatch(/never nested/i)
  })

  it('restricts punctuation to ASCII so binary writers do not corrupt', () => {
    expect(P).toMatch(/only plain ASCII punctuation/i)
    for (const ch of ['—', '–', '•', '’', '“', '…']) {
      expect(P.includes(`Never emit`), 'ASCII rule must be stated').toBe(true)
      expect(P.includes(ch), `prompt body must not itself contain ${ch}`).toBe(false)
    }
  })
})

describe('prompt contract · structure survived the rewrite', () => {
  it('still carries the environment facts the runtime depends on', () => {
    expect(P).toMatch(/llama-server\.exe/i)
    expect(P).toMatch(/workspace/i)
  })

  it('still documents the tool surface', () => {
    for (const t of ['fs_read', 'fs_write', 'shell_exec', 'search_skills', 'read_skill', 'todo_write', 'clarify']) {
      expect(P, `tool ${t} is no longer documented`).toContain(t)
    }
  })

  it('is a sane size for a 4B local model', () => {
    // Guard against the prompt ballooning past the small model's usable context.
    const approxTokens = Math.round(P.length / 4)
    expect(approxTokens, `prompt is ~${approxTokens} tokens — too large for a 4B local model`).toBeLessThan(6500)
  })
})
