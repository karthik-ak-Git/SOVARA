import { describe, it, expect } from 'vitest'
import { extractToolFences, stripToolFences, looksLikeToolFence, parseLenientJson, extractBareToolCalls, stripBareToolCalls, looksLikeBareToolCall, extractJsonToolCalls, stripJsonToolCallEnvelopes } from '../src/main/backend/tools/fenceTools'

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

  it('parses the skill and clarification tools exposed by the runtime', () => {
    expect(extractToolFences('```tool:search_skills\n{"query":"python"}\n```')[0]?.toolName).toBe('search_skills')
    expect(extractToolFences('```tool:clarify\n{"questions":[]}\n```')[0]?.toolName).toBe('clarify')
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

describe('JSON tool envelopes', () => {
  it('parses a legacy thought/action/tool_call envelope as an executable call', () => {
    const text = '```json-output\n{"thought":"Run the solver","action":"shell_exec","tool_call":{"command":"python ode_solver.py"}}\n```'
    const calls = extractJsonToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ toolName: 'shell_exec', args: { command: 'python ode_solver.py' } })
    expect(stripJsonToolCallEnvelopes(text)).toBe('')
  })

  it('parses run_code fences whose JavaScript contains quoted arguments', () => {
    const text = '```tool:run_code\n{"code":"return await tools.fs_write({ path: \'nested.txt\', content: \'hello\' })"}\n```'
    const calls = extractToolFences(text)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ toolName: 'run_code', args: { code: "return await tools.fs_write({ path: 'nested.txt', content: 'hello' })" } })
  })
})

describe('extractBareToolCalls and stripBareToolCalls', () => {
  it('parses Spark XHToken XML tool call with arg_key and arg_value', () => {
    const raw = '<tool_call>fs_read<arg_key>path</arg_key><arg_value>D:\\synthetic-vivarium\\Synthetic-Vivarium-Frontend\\README.md</arg_value></tool_call>'
    expect(looksLikeBareToolCall(raw)).toBe(true)
    const calls = extractBareToolCalls(raw)
    expect(calls).toHaveLength(1)
    expect(calls[0].toolName).toBe('fs_read')
    expect(calls[0].args).toEqual({ path: 'D:\\synthetic-vivarium\\Synthetic-Vivarium-Frontend\\README.md' })
    expect(stripBareToolCalls(raw)).toBe('')
  })

  it('parses tool_call containing JSON', () => {
    const raw = '<tool_call>{"name": "fs_read", "arguments": {"path": "src/App.tsx"}}</tool_call>'
    const calls = extractBareToolCalls(raw)
    expect(calls).toHaveLength(1)
    expect(calls[0].toolName).toBe('fs_read')
    expect(calls[0].args).toEqual({ path: 'src/App.tsx' })
  })

  it('parses invoke name with parameter tags', () => {
    const raw = '<invoke name="fs_read"><parameter name="path">README.md</parameter></invoke>'
    const calls = extractBareToolCalls(raw)
    expect(calls).toHaveLength(1)
    expect(calls[0].toolName).toBe('fs_read')
    expect(calls[0].args).toEqual({ path: 'README.md' })
  })

  it('parses XML tag style <fs_read path="..."/>', () => {
    const raw = '<fs_read path="D:/test.txt">'
    const calls = extractBareToolCalls(raw)
    expect(calls).toHaveLength(1)
    expect(calls[0].toolName).toBe('fs_read')
    expect(calls[0].args).toEqual({ path: 'D:/test.txt' })
  })

  it('parses bare tool_call with trailing arguments', () => {
    const raw = 'fs_read {"path": "test.txt"}'
    const calls = extractBareToolCalls(raw)
    expect(calls).toHaveLength(1)
    expect(calls[0].toolName).toBe('fs_read')
    expect(calls[0].args).toEqual({ path: 'test.txt' })
  })
})
