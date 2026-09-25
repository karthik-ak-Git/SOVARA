import { describe, it, expect } from 'vitest'
import {
  ReasoningSplitter,
  extractThought,
  sanitizeAssistantText,
  ensureRecap,
} from '../src/shared/assistantProtocol'

function runThrough(chunks: string[]) {
  const splitter = new ReasoningSplitter()
  const texts: string[] = []
  const reasonings: string[] = []
  let ends = 0
  for (const chunk of chunks) {
    for (const ev of splitter.push(chunk)) {
      if (ev.kind === 'text') texts.push(ev.value)
      if (ev.kind === 'reasoning') reasonings.push(ev.value)
      if (ev.kind === 'reasoning-end') ends++
    }
  }
  for (const ev of splitter.flush()) {
    if (ev.kind === 'text') texts.push(ev.value)
    if (ev.kind === 'reasoning') reasonings.push(ev.value)
    if (ev.kind === 'reasoning-end') ends++
  }
  return { text: texts.join(''), reasoning: reasonings.join(''), ends }
}

describe('assistantProtocol — JSON reasoning blocks', () => {
  it('routes a fenced json:reasoning block to reasoning, answer stays clean', () => {
    const r = runThrough(['```json:reasoning\n{"thought": "checking"}\n```\nHello'])
    expect(r.reasoning).toBe('checking')
    expect(r.text).toBe('\nHello')
    expect(r.ends).toBe(1)
  })

  it('split close fence across chunks still parses the thought once', () => {
    const r = runThrough(['```json:reasoning\n{"thought": "ab', 'cd"}\n``', '`\nHi'])
    expect(r.reasoning).toBe('abcd')
    expect(r.ends).toBe(1)
    expect(r.text).toBe('\nHi')
  })

  it('split open fence across chunks does not leak the marker', () => {
    const r = runThrough(['He', 'llo ```json:rea', 'soning\n{"thought": "x"}\n```done'])
    expect(r.text).toBe('Hello done')
    expect(r.reasoning).toBe('x')
  })

  it('unclosed fence still yields the thought at flush', () => {
    const r = runThrough(['```json:reasoning\n{"thought": "abcd"}'])
    expect(r.reasoning).toBe('abcd')
    expect(r.ends).toBe(1)
    expect(r.text).toBe('')
  })

  it('legacy thinking blocks keep incremental behavior', () => {
    const r = runThrough(['<thinking>ab', 'cd</thinking>', 'Hi'])
    expect(r.reasoning).toBe('abcd')
    expect(r.text).toBe('Hi')
    expect(r.ends).toBe(1)
  })

  it('legacy unclosed thinking block persists at flush', () => {
    const r = runThrough(['<thinking>ab', 'cd'])
    expect(r.reasoning).toBe('abcd')
    expect(r.ends).toBe(1)
  })

  it('plain answer without markers passes through untouched', () => {
    const r = runThrough(['Hello', ' world'])
    expect(r.text).toBe('Hello world')
    expect(r.reasoning).toBe('')
    expect(r.ends).toBe(0)
  })

  it('code fences in the answer do not open reasoning', () => {
    const r = runThrough(['Here:\n```python\nprint(1)\n```\nDone'])
    expect(r.text).toBe('Here:\n```python\nprint(1)\n```\nDone')
    expect(r.ends).toBe(0)
  })
})

describe('extractThought', () => {
  it('parses thought / reasoning / thinking keys', () => {
    expect(extractThought('{"thought": "a"}')).toBe('a')
    expect(extractThought('{"reasoning": "b"}')).toBe('b')
    expect(extractThought('{"thinking": "c"}')).toBe('c')
  })

  it('falls back to raw text when not JSON', () => {
    expect(extractThought('just some words')).toBe('just some words')
    expect(extractThought('')).toBe('')
  })
})

describe('sanitizeAssistantText', () => {
  it('removes closed and unclosed json:reasoning fences', () => {
    expect(sanitizeAssistantText('A\n```json:reasoning\n{"thought":"x"}\n```\nB')).toBe('A\n\nB')
    expect(sanitizeAssistantText('A\n```json:reasoning\n{"thought":"x"}')).toBe('A')
  })

  it('removes legacy thinking blocks and stray tags', () => {
    expect(sanitizeAssistantText('A<thinking>secret</thinking>B')).toBe('AB')
    expect(sanitizeAssistantText('A<thinking>secret')).toBe('A')
    expect(sanitizeAssistantText('A</thinking>B')).toBe('AB')
  })

  it('removes the TRUNCATED continuation marker', () => {
    expect(
      sanitizeAssistantText('code\n<!-- TRUNCATED — continuation follows (do not re-render as final) -->')
    ).toBe('code')
  })

  it('strips protocol tags but keeps real code fences and HTML', () => {
    const raw = 'Hi <system_message>leak</system_message>\n```python\nx = "<div>"\n```\n<svg></svg>'
    const out = sanitizeAssistantText(raw)
    expect(out).not.toContain('system_message')
    expect(out).toContain('x = "<div>"')
    expect(out).toContain('<svg></svg>')
  })

  it('trims a split-tag tail without touching prose comparisons', () => {
    expect(sanitizeAssistantText('answer text <thin')).toBe('answer text')
    expect(sanitizeAssistantText('use a < b here')).toBe('use a < b here')
  })
})

describe('ensureRecap', () => {
  it('leaves text with a Recap section untouched', () => {
    const t = 'Answer.\n\n## Recap\n- Did: x'
    expect(ensureRecap(t, { tools: [{ name: 'fs_list' }] })).toBe(t)
  })

  it('appends an honest trace-based recap', () => {
    const out = ensureRecap('Answer.', {
      tools: [{ name: 'fs_list' }, { name: 'fs_write', args: { path: 'a.py' } }],
      files: ['a.py'],
      model: 'm1',
    })
    expect(out).toContain('## Recap')
    expect(out).toContain('fs_list, fs_write')
    expect(out).toContain('a.py')
    expect(out).toContain('m1')
  })

  it('handles the no-tools case', () => {
    expect(ensureRecap('Answer.', { tools: [] })).toContain('answered directly (no tools used)')
  })
})
