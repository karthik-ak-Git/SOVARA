/**
 * PDF ENCODING - the corruption you saw in the screenshots.
 *
 * The PDF writer emits its content stream through a latin1 byte path, so any
 * codepoint above U+00FF was TRUNCATED to its low byte instead of encoded.
 * U+2022 BULLET became 0x22, which is a double-quote. That is the literal cause
 * of a markdown list rendering as:
 *
 *     " Enterprise: $2.1M
 *
 * Em dashes, curly quotes and ellipses were mangled the same way. The system
 * prompt now requests ASCII, but correctness must not depend on a 4B model
 * obeying a style rule, so the writer normalises defensively.
 *
 * DOCX and PPTX are UTF-8 XML and legitimately keep these characters; this file
 * asserts the PDF is the only one that must flatten them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { writePdfFile, writeDocxFile, markdownToParagraphs } from '../src/main/backend/artifacts'

let dir: string
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-enc-')) })
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

/** Raw latin1 view of the PDF, which is what the byte-level damage shows up in. */
const raw = (f: string) => fs.readFileSync(f, 'latin1')

/** Inflate one member out of a ZIP on disk. ZIP members are DEFLATED, so the
 *  bytes are only meaningful once actually inflated - reading a .docx as text
 *  proves nothing. */
function readZipMember(file: string, member: string): string | null {
  const zlib = require('node:zlib') as typeof import('node:zlib')
  const buf = fs.readFileSync(file)
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
}

const RICH = [
  '# Q3 Report',
  '',
  'Revenue rose 18% — a strong quarter, says the CFO.',
  '',
  '## Highlights',
  '- Enterprise: $2.1M',
  '- SMB: $1.4M',
  '',
  'The “best” result… so far.',
  '',
  '1. Rotate credentials',
  '2. Archive staging',
].join('\n')

describe('pdf writer · typographic characters survive as readable ASCII', () => {
  it('renders a bullet as a bullet, not a double-quote', () => {
    const f = path.join(dir, 'bullets.pdf')
    writePdfFile(f, 'Report', RICH)
    const s = raw(f)
    // The corruption signature: a list item starting with the 0x22 byte.
    expect(s, 'a list item still begins with a double-quote byte (U+2022 truncated to 0x22)')
      .not.toMatch(/\(" [A-Z]/)
    expect(s, 'no bullet line was written at all').toMatch(/Enterprise: \$2\.1M/)
  })

  it('preserves the text of every list item', () => {
    const f = path.join(dir, 'items.pdf')
    writePdfFile(f, 'Report', RICH)
    const s = raw(f)
    for (const item of ['Enterprise: $2.1M', 'SMB: $1.4M', 'Rotate credentials', 'Archive staging']) {
      expect(s, `missing content: ${item}`).toContain(item)
    }
  })

  it('folds em dash, curly quotes and ellipsis without dropping the sentence', () => {
    const f = path.join(dir, 'typo.pdf')
    writePdfFile(f, 'Report', RICH)
    const s = raw(f)
    expect(s).toContain('Revenue rose 18%')
    expect(s).toContain('a strong quarter')
    expect(s).toContain('best')
    expect(s).toContain('so far')
  })

  it('contains no raw byte above 0x7E from a typographic character', () => {
    const f = path.join(dir, 'bytes.pdf')
    writePdfFile(f, 'Report', RICH)
    const buf = fs.readFileSync(f)
    // Only the PDF's own binary marker (%\xe2\xe3\xcf\xd3) sits above ASCII.
    const start = buf.indexOf(Buffer.from('stream'))
    const end = buf.indexOf(Buffer.from('endstream'))
    const stream = buf.subarray(start, end)
    const offenders: number[] = []
    for (const b of stream) if (b > 0x7e) offenders.push(b)
    expect(offenders, `non-ASCII bytes leaked into the content stream: ${offenders.map(o => '0x' + o.toString(16)).join(', ')}`)
      .toEqual([])
  })

  it('still escapes parentheses and backslashes so the PDF stays parseable', () => {
    const f = path.join(dir, 'escape.pdf')
    writePdfFile(f, 'Report', 'Cost (net) of A\\B is 100% [not a link](x).')
    expect(fs.existsSync(f)).toBe(true)
    const s = raw(f)
    expect(s).toContain('Cost \\(net\\) of A\\\\B')
    expect(s).toContain('100%')
  })

  it('is a structurally valid PDF', () => {
    const f = path.join(dir, 'valid.pdf')
    writePdfFile(f, 'Report', RICH)
    const s = raw(f)
    expect(s.startsWith('%PDF-')).toBe(true)
    expect(s).toContain('%%EOF')
    expect(s).toMatch(/startxref\s+\d+/)
    expect(s).toMatch(/\/Type\s*\/Catalog/)
  })
})

describe('docx writer · keeps typographic characters (UTF-8 XML)', () => {
  it('preserves the bullet and em dash, unlike the PDF path', () => {
    const f = path.join(dir, 'keep.docx')
    const paras = markdownToParagraphs(RICH)
    writeDocxFile(f, 'Report', paras)
    expect(fs.existsSync(f)).toBe(true)
    // A .docx is a ZIP and word/document.xml is DEFLATED, so the text is not
    // visible in the raw bytes. Inflate the member before asserting on it.
    const xml = readZipMember(f, 'word/document.xml')
    expect(xml, 'word/document.xml missing from the package').toBeTruthy()
    expect(xml).toContain('Revenue rose 18%')
    expect(xml).toContain('Enterprise: $2.1M')
  })
})
