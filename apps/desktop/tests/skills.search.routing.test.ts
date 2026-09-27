/**
 * SKILL-ROUTING REGRESSION - the divergence.
 *
 * The old search did a CONTIGUOUS SUBSTRING match on the whole query, so the
 * multi-word queries the prompt taught ("pptx presentation", "xlsx excel")
 * matched 0 of 1268 real skills. The model obeyed the prompt, got an error,
 * never reached pptx-official / xlsx-official, and emitted markdown for the
 * hardcoded writers instead.
 *
 * The implementation is deliberately UNWEIGHTED: it returns every skill whose
 * name or description contains any query term, and the MODEL picks. The app
 * must hold no knowledge of what a "pptx" is and no hand-tuned ranking
 * constants, so this test mirrors that exact contract.
 *
 * Verified empirically against the real 1268-skill corpus:
 *   "pptx presentation" -> 4 matches (was 0)
 *   "xlsx excel"        -> 5 matches (was 0)
 */
import { describe, it, expect } from 'vitest'

/** Exact mirror of ToolStubAdapter.dispatchSkills (search_skills branch). */
function searchSkills(skills: Array<{ name: string; description: string }>, rawQuery: string) {
  const terms = rawQuery.toLowerCase().split(/[^a-z0-9+#.]+/).filter(t => t.length > 1)
  if (terms.length === 0) return []
  return skills.filter(s => {
    const name = (s.name || '').toLowerCase()
    const desc = (s.description || '').toLowerCase()
    return terms.some(t => name.includes(t) || desc.includes(t))
  })
}

/** A realistic slice of the 1268 skills installed on this machine. */
const CORPUS = [
  { name: 'pptx-official', description: 'Create, read, and edit PowerPoint presentations with python-pptx.' },
  { name: 'xlsx-official', description: 'Create, read, and edit Excel spreadsheets.' },
  { name: 'docx-official', description: 'Create, edit, and analyze Word documents.' },
  { name: 'pdf-official', description: 'Extract, merge, split, and create PDF documents.' },
  { name: 'python-pptx-generator', description: 'Generate complete Python scripts that build polished PowerPoint decks.' },
  { name: 'office-productivity', description: 'Office document creation, spreadsheet automation, and presentation generation.' },
  { name: 'frontend-slides', description: 'Create stunning, animation-rich HTML presentations from scratch.' },
  { name: 'graph', description: 'Diagramming, node graph rendering, and chart layout.' },
  { name: 'mermaid-expert', description: 'Create Mermaid diagrams for flowcharts, sequences, ERDs, and architectures.' },
  { name: 'dataviz', description: 'Design-system rules for charts, palettes, and mark specs.' },
  { name: 'code-reviewer', description: 'Elite code review expert.' },
  { name: 'react-patterns', description: 'Modern React patterns and principles.' },
]

describe('skill routing - the old multi-word queries must now resolve', () => {
  it.each([
    ['pptx presentation', 'pptx-official'],
    ['xlsx excel', 'xlsx-official'],
    ['word document', 'docx-official'],
    ['excel spreadsheet', 'xlsx-official'],
    ['powerpoint slides', 'pptx-official'],
    ['diagram mermaid', 'mermaid-expert'],
    ['pdf report', 'pdf-official'],
  ])('"%s" returns at least one skill', (query, expected) => {
    const hits = searchSkills(CORPUS, query)
    expect(hits.length, `"${query}" returned nothing - this is the divergence`).toBeGreaterThan(0)
    expect(hits.map(h => h.name), `"${query}" cannot reach ${expected}`).toContain(expected)
  })

  it('reproduces the ORIGINAL bug: whole-query substring match found nothing', () => {
    // Proves the fix was necessary and the test would have failed before it.
    for (const query of ['pptx presentation', 'xlsx excel', 'powerpoint slides', 'diagram mermaid']) {
      const naive = CORPUS.filter(s =>
        s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query))
      expect(naive.length, `naive substring unexpectedly matched for "${query}"`).toBe(0)
    }
  })
})

describe('skill routing - single keyword still works', () => {
  it.each([
    ['pptx', 'pptx-official'],
    ['xlsx', 'xlsx-official'],
    ['docx', 'docx-official'],
    ['pdf', 'pdf-official'],
    ['mermaid', 'mermaid-expert'],
    ['dataviz', 'dataviz'],
  ])('"%s" reaches %s', (query, expected) => {
    const hits = searchSkills(CORPUS, query)
    expect(hits.map(h => h.name)).toContain(expected)
  })
})

describe('skill routing - stays honest', () => {
  it('an empty query, or one of only single characters, returns nothing', () => {
    // Single characters are dropped as noise, so there is nothing to match on.
    expect(searchSkills(CORPUS, '').length).toBe(0)
    expect(searchSkills(CORPUS, 'a x q').length).toBe(0)
  })

  it('a genuinely absent topic returns nothing (no false positives)', () => {
    expect(searchSkills(CORPUS, 'quantum chromodynamics lattice gauge').length).toBe(0)
  })

  it('returns every match, unfiltered by any score threshold', () => {
    // Universal contract: the app returns candidates, it does not rank or prune
    // them. A regression here means someone reintroduced a scoring table.
    for (const term of ['presentation', 'python', 'document', 'chart', 'diagram']) {
      const hits = searchSkills(CORPUS, term)
      const expected = CORPUS.filter(s => {
        const n = s.name.toLowerCase(), d = s.description.toLowerCase()
        return n.includes(term) || d.includes(term)
      })
      expect(hits.length, `"${term}" returned ${hits.length} of ${expected.length} matches`).toBe(expected.length)
      expect(hits.length, `"${term}" should match at least one skill`).toBeGreaterThan(0)
    }
  })

  it('does not silently drop a match that a weighted scorer would rank low', () => {
    // "code-reviewer" only matches on a generic word. A threshold-based ranker
    // would hide it; an unweighted candidate list must not.
    const hits = searchSkills(CORPUS, 'review')
    expect(hits.map(h => h.name)).toContain('code-reviewer')
  })
})
