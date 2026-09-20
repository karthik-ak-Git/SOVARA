import { describe, it, expect } from 'vitest'
import { extractToolFences, stripToolFences, looksLikeToolFence, parseLenientJson } from '../src/main/backend/tools/fenceTools'

describe('extractToolFences', () => {
  it('parses a standard 3-tick fence', () => {
    const text = 'hello\n```tool:fs_list\n{"path": "."}\n```\nbye'
    const fences = extractToolFences(text)
    expect(fences).toHaveLength(1)
    expect(fences[0].toolName).toBe('fs_list')
    expect(fences[0].args).toEqual({ path: '.' })
  })

  it('parses GLUED fences (the 12:55 PM screenshot bug) as two calls', () => {
    const text = '``````tool:fs_list\n{"path": "."}\n```\ntext between\n```tool:fs_list\n{"path": "src"}\n```'
    const fences = extractToolFences(text)
    expect(fences.length).toBeGreaterThanOrEqual(2)
    expect(fences[0].toolName).toBe('fs_list')
    expect(fences[0].args).toEqual({ path: '.' })
  })

  it('parses 4-tick and 5-tick fences', () => {
    const a = extractToolFences('````tool:fs_read\n{"path": "a.ts"}\n````')
    expect(a).toHaveLength(1)
    expect(a[0].args).toEqual({ path: 'a.ts' })
    const b = extractToolFences('`````tool:shell_exec\n{"command": "dir"}\n`````')
    expect(b).toHaveLength(1)
    expect(b[0].toolName).toBe('shell_exec')
  })

  it('parses mismatched tick counts (open 4, close 3)', () => {
    const fences = extractToolFences('````tool:fs_list\n{"path": "."}\n```')
    expect(fences).toHaveLength(1)
  })

  it('accepts missing tool: prefix', () => {
    const fences = extractToolFences('```\nfs_list\n{"path": "."}\n```')
    expect(fences).toHaveLength(1)
    expect(fences[0].toolName).toBe('fs_list')
  })

  it('repairs the wrong todo_write shape ({pending,in_progress,completed})', () => {
    const text = '```tool:todo_write\n{\n  "pending": [\n    "read the code once"\n  ],\n  "in_progress": [],\n  "completed": []\n}\n```'
    const fences = extractToolFences(text)
    expect(fences).toHaveLength(1)
    expect(fences[0].toolName).toBe('todo_write')
    const todos = fences[0].args['todos'] as Array<{ content: string; status: string }>
    expect(Array.isArray(todos)).toBe(true)
    expect(todos[0]).toEqual({ content: 'read the code once', status: 'pending' })
  })

  it('repairs unquoted keys and single quotes', () => {
    const fences = extractToolFences("```tool:fs_read\n{ path: 'src/main.ts' }\n```")
    expect(fences).toHaveLength(1)
    expect(fences[0].args).toEqual({ path: 'src/main.ts' })
  })

  it('defaults empty fs_list args to path "."', () => {
    const fences = extractToolFences('```tool:fs_list\n\n```')
    expect(fences).toHaveLength(1)
    expect(fences[0].args).toEqual({ path: '.' })
  })
})

describe('stripToolFences', () => {
  it('removes glued fences without leaving tick residue', () => {
    const text = 'before ``````tool:fs_list\n{"path":"."}\n``` mid ```tool:fs_list\n{"path":"x"}\n``` after'
    const out = stripToolFences(text)
    expect(out).not.toContain('tool:')
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  it('returns text unchanged when no fences exist', () => {
    expect(stripToolFences('plain text with ```code``` blocks')).toBe('plain text with ```code``` blocks')
  })
})

describe('looksLikeToolFence', () => {
  it('detects leaks the orchestrator must recover from', () => {
    expect(looksLikeToolFence('``````tool:fs_list\n{"path":"."}\n```')).toBe(true)
    expect(looksLikeToolFence('```tool:todo_write\n{}\n```')).toBe(true)
    expect(looksLikeToolFence('just talking about ```tool syntax')).toBe(false)
  })
})

describe('parseLenientJson', () => {
  it('handles strict JSON', () => {
    expect(parseLenientJson('{"path":"."}')).toEqual({ path: '.' })
  })
  it('handles trailing commas and unquoted keys', () => {
    expect(parseLenientJson('{ path: ".", extra: 1, }')).toEqual({ path: '.', extra: 1 })
  })
  it('extracts path from prose-ish garbage', () => {
    expect(parseLenientJson('path = D:\\\\data\\\\rewards')).toEqual({ path: 'D:\\\\data\\\\rewards' })
  })
  it('returns tool defaults for empty input and fallbacks for pure junk', () => {
    expect(parseLenientJson('')).toEqual({})
    expect(parseLenientJson('', 'fs_list')).toEqual({ path: '.' })
    expect(parseLenientJson('%%%')).toEqual({})
    expect(parseLenientJson('%%%', 'fs_list')).toEqual({ path: '.' })
  })
})
