import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ToolStubAdapter } from '../src/main/backend/ports/ToolStubAdapter'
import { extractToolFences } from '../src/main/backend/tools/fenceTools'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-mem-'))
}

describe('memory → wiki/*.md seam (plan verification)', () => {
  it('store writes frontmatter + wikilinks, merges on repeat, recall/list find it', async () => {
    const dir = mkTmp()
    const tools = new ToolStubAdapter(
      { enabled: false, search: async () => { throw new Error('disabled') }, crawl: async () => [] },
      () => [],
      () => dir,
    )
    const defs = tools.list().map((d) => d.name)
    expect(defs).toContain('memory')

    const r1 = JSON.parse(await tools.dispatch('memory', {
      action: 'store', title: 'Dechloromonas', type: 'entity',
      body: 'Perchlorate-reducing bacteria.', links: ['Wiki Log'], tags: ['bioremediation'],
    }))
    expect(r1.ok).toBe(true)
    const f = path.join(dir, 'wiki/entities/dechloromonas.md')
    expect(fs.existsSync(f)).toBe(true)
    const c1 = fs.readFileSync(f, 'utf8')
    expect(c1).toContain('title: "Dechloromonas"')
    expect(c1).toContain('type: entity')
    expect(c1).toContain('[[Wiki Log]]')

    // repeat store merges: new dated entry + union links, old body kept
    const r2 = JSON.parse(await tools.dispatch('memory', {
      action: 'store', title: 'Dechloromonas', type: 'entity',
      body: 'Also reduces nitrate.', links: ['Nitrate'],
    }))
    expect(r2.ok).toBe(true)
    const c2 = fs.readFileSync(f, 'utf8')
    expect(c2).toContain('Perchlorate-reducing bacteria.')
    expect(c2).toContain('Also reduces nitrate.')
    expect(c2).toContain('[[Wiki Log]]')
    expect(c2).toContain('[[Nitrate]]')

    const recall = JSON.parse(await tools.dispatch('memory', { action: 'recall', query: 'Dechloromonas' }))
    expect(JSON.stringify(recall)).toContain('dechloromonas.md')

    const list = JSON.parse(await tools.dispatch('memory', { action: 'list' }))
    expect(JSON.stringify(list)).toContain('entities')

    expect(JSON.parse(await tools.dispatch('memory', { action: 'store' })).error).toMatch(/title/)
    expect(JSON.parse(await tools.dispatch('memory', { action: 'bogus' })).error).toMatch(/store.*recall.*list/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('model fences parse tool:memory', () => {
    const fences = extractToolFences('```tool:memory\n{"action":"list"}\n```')
    expect(fences.map((f) => f.toolName)).toContain('memory')
  })
})
