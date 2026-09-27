/**
 * The parser must read whatever dialect the model actually emits.
 *
 * Measured live against Spark-X2.5-4B on SOVARA's own sidecar, identical
 * prompt, temperature 0.2, three consecutive runs:
 *
 *     fences parsed: 18, 0, 1        arg-tag form: no, YES, no
 *
 * The model flip-flops between the ```tool:name fence the prompt requests and
 * an <arg_key>/<arg_value> form. The old parser read only the fence, so on the
 * runs that produced the arg-tag form the turn yielded ZERO tool calls and the
 * agent loop died. That is the "agent steps=33, completionTokens=20" failure
 * already sitting in the app's own chat.log.
 *
 * These tests pin the exact strings the live model produced, including the
 * zero-width characters that appear INSIDE the tag names.
 */
import { describe, it, expect } from 'vitest'
import { extractToolFences } from '../src/main/backend/tools/fenceTools'

/** Byte-for-byte what Spark-X2.5-4B emitted on the failing live run. */
const LIVE_ARG_TAG = '<tool_call>search_skills<arg_key>query</arg_key><arg_value>pdf</arg_value></tool_call>'

/** Same, with the zero-width characters removed. */
const CLEAN_ARG_TAG = '<tool_call>search_skills<arg_key>query</arg_key><arg_value>pdf</arg_value></tool_call>'

describe('tool-call parser Â· the arg-tag dialect the model actually emits', () => {
  it('parses the exact string captured from the live model', () => {
    const f = extractToolFences(LIVE_ARG_TAG)
    expect(f.length, 'the live output parsed to zero tool calls - the loop dies here').toBe(1)
    expect(f[0]!.toolName).toBe('search_skills')
    expect((f[0]!.args as Record<string, unknown>).query).toBe('pdf')
  })

  it('parses the same shape with zero-width characters stripped', () => {
    const f = extractToolFences(CLEAN_ARG_TAG)
    expect(f.length).toBe(1)
    expect(f[0]!.toolName).toBe('search_skills')
  })

  it('parses multiple calls in one turn', () => {
    const out = [
      '<tool_call>search_skills<arg_key>query</arg_key><arg_value>pdf</arg_value></tool_call>',
      '<tool_call>read_skill<arg_key>skill_name</arg_key><arg_value>pdf-official</arg_value></tool_call>',
    ].join('\n')
    const f = extractToolFences(out)
    expect(f.map(x => x.toolName)).toEqual(['search_skills', 'read_skill'])
    expect((f[1]!.args as Record<string, unknown>).skill_name).toBe('pdf-official')
  })

  it('parses a JSON payload inside the tag pair', () => {
    const out = '<tool_call>{"name":"shell_exec","arguments":{"command":"python x.py"}}</tool_call>'
    const f = extractToolFences(out)
    expect(f.length).toBe(1)
    expect(f[0]!.toolName).toBe('shell_exec')
    expect((f[0]!.args as Record<string, unknown>).command).toBe('python x.py')
  })

  it('parses the ChatML separator form', () => {
    const out = '<|tool_call_begin|><|tool_sep|>fs_read<|tool_call_end|>{"path":"a.txt"}'
    const f = extractToolFences(out)
    expect(f.length).toBe(1)
    expect(f[0]!.toolName).toBe('fs_read')
    expect((f[0]!.args as Record<string, unknown>).path).toBe('a.txt')
  })

  it('parses <function_calls> wrapping a single call', () => {
    const out = '<function_calls><tool_call>fs_list<arg_key>path</arg_key><arg_value>.</arg_value></tool_call></function_calls>'
    const f = extractToolFences(out)
    expect(f.length).toBe(1)
    expect(f[0]!.toolName).toBe('fs_list')
  })
})

describe('tool-call parser Â· the fence dialect still works', () => {
  it('parses the standard named fence', () => {
    const f = extractToolFences('```tool:search_skills\n{"query":"pdf"}\n```')
    expect(f.length).toBe(1)
    expect(f[0]!.toolName).toBe('search_skills')
    expect((f[0]!.args as Record<string, unknown>).query).toBe('pdf')
  })

  it('parses a bare-name fence with the name on the first body line', () => {
    const f = extractToolFences('```\nfs_list\n{"path":"."}\n```')
    expect(f.length).toBe(1)
    expect(f[0]!.toolName).toBe('fs_list')
  })

  it('still handles a multi-call turn in fence form', () => {
    const out = '```tool:fs_list\n{"path":"."}\n```\n```tool:fs_read\n{"path":"a"}\n```'
    expect(extractToolFences(out).map(x => x.toolName)).toEqual(['fs_list', 'fs_read'])
  })
})

describe('tool-call parser Â· argument typing', () => {
  it('types booleans, numbers and JSON, and leaves prose alone', () => {
    const out = [
      '<tool_call>todo_write',
      '<arg_key>done</arg_key><arg_value>true</arg_value>',
      '<arg_key>count</arg_key><arg_value>42</arg_value>',
      '<arg_key>ratio</arg_key><arg_value>0.75</arg_value>',
      '<arg_key>opts</arg_key><arg_value>{"a":1}</arg_value>',
      '<arg_key>path</arg_key><arg_value>C:\\out\\report.pdf</arg_value>',
      '</tool_call>',
    ].join('')
    const a = extractToolFences(out)[0]!.args as Record<string, unknown>
    expect(a.done).toBe(true)
    expect(a.count).toBe(42)
    expect(a.ratio).toBe(0.75)
    expect(a.opts).toEqual({ a: 1 })
    expect(a.path).toBe('C:\\out\\report.pdf')
  })

  it('does not invent a call from ordinary prose', () => {
    expect(extractToolFences('I will search for a skill and then build the report.').length).toBe(0)
    expect(extractToolFences('Here is a plan:\n1. Find a skill\n2. Write a script').length).toBe(0)
  })

  it('ignores malformed JSON rather than throwing', () => {
    expect(() => extractToolFences('<tool_call>{"name":"fs_read",oops}</tool_call>')).not.toThrow()
  })
})

describe('tool-call parser · bare JSON action object dialect (Nemotron / Qwen format)', () => {
  it('parses bare JSON objects with action: fswrite and action: shellexec', () => {
    const text = [
      '# Save as revenue',
      '{ "action": "fswrite", "path": "generaterevenuereport.py", "content": "from pypdf import PdfWriter" }',
      '{ "action": "shellexec", "command": "python generaterevenuereport.py" }',
      '{ "action": "fsread", "path": "revenue.pdf", "start_line": 1, "end_line": 10 }'
    ].join('\n\n')

    const fences = extractToolFences(text)
    expect(fences.length).toBe(3)
    expect(fences[0]!.toolName).toBe('fs_write')
    expect((fences[0]!.args as any).path).toBe('generaterevenuereport.py')
    expect(fences[1]!.toolName).toBe('shell_exec')
    expect((fences[1]!.args as any).command).toBe('python generaterevenuereport.py')
    expect(fences[2]!.toolName).toBe('fs_read')
    expect((fences[2]!.args as any).path).toBe('revenue.pdf')
  })

  it('parses implicit JSON objects with path/content and command signatures (Nemotron live session format)', () => {
    const text = [
      '{"path": "revenue.py", "content": "from reportlab.lib.pagesizes import letter\\nimport canvas", "status": "pending"}',
      '{"command": "python revenue.py", "status": "pending"}',
      '{"path": "revenue.pdf", "startline": 1, "endline": 30, "status": "pending"}'
    ].join('\n\n')

    const fences = extractToolFences(text)
    expect(fences.length).toBe(3)
    expect(fences[0]!.toolName).toBe('fs_write')
    expect((fences[0]!.args as any).path).toBe('revenue.py')
    expect(fences[1]!.toolName).toBe('shell_exec')
    expect((fences[1]!.args as any).command).toBe('python revenue.py')
    expect(fences[2]!.toolName).toBe('fs_read')
    expect((fences[2]!.args as any).path).toBe('revenue.pdf')
  })
})
