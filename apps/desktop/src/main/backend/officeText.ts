/**
 * officeText — dependency-free text extraction from .docx and .xlsx.
 *
 * Both formats are ZIP packages. The bundled mini-unzipper handles the
 * common case (local file headers with known sizes, stored or deflated).
 * Entries using data descriptors are skipped — callers report partial
 * results honestly instead of failing the whole file.
 */

import { inflateRawSync } from 'node:zlib'

/** Read a ZIP member by name. Throws on unreadable archives. */
export function unzipMember(buf: Buffer, memberName: string): Buffer | null {
  let off = 0
  const n = buf.length
  while (off + 30 <= n) {
    const sig = buf.readUInt32LE(off)
    if (sig === 0x04034b50) {
      const flags = buf.readUInt16LE(off + 6)
      const method = buf.readUInt16LE(off + 8)
      const compSize = buf.readUInt32LE(off + 18)
      const nameLen = buf.readUInt16LE(off + 26)
      const extraLen = buf.readUInt16LE(off + 28)
      const name = buf.toString('utf8', off + 30, off + 30 + nameLen)
      const dataOff = off + 30 + nameLen + extraLen
      const hasDescriptor = (flags & 0x08) !== 0
      if (!hasDescriptor && dataOff + compSize <= n && name === memberName) {
        const raw = buf.subarray(dataOff, dataOff + compSize)
        if (method === 0) return Buffer.from(raw)
        if (method === 8) return inflateRawSync(raw)
        return null // unsupported compression — skip honestly
      }
      if (!hasDescriptor) {
        off = dataOff + compSize
        continue
      }
      return null // data descriptors unsupported — bail rather than misparse
    }
    if (sig === 0x02014b50 || sig === 0x06054b50) break // central dir / EOCD
    off++
  }
  return null
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(parseInt(d, 10)))
}

/** Extract readable paragraphs from word/document.xml. */
export function extractDocxText(buf: Buffer, maxChars = 60_000): { text: string; truncated: boolean } {
  let xml: Buffer | null = null
  try {
    xml = unzipMember(buf, 'word/document.xml')
  } catch {
    xml = null
  }
  if (!xml) return { text: '', truncated: false }
  const src = xml.toString('utf8')
  const paras: string[] = []
  const pRe = /<w:p[\s>]([\s\S]*?)<\/w:p>/g
  let m: RegExpExecArray | null
  while ((m = pRe.exec(src)) !== null) {
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
    let t: RegExpExecArray | null
    let para = ''
    while ((t = tRe.exec(m[1] ?? '')) !== null) para += decodeXmlEntities(t[1] ?? '')
    para = para.replace(/\s+/g, ' ').trim()
    if (para) paras.push(para)
  }
  const text = paras.join('\n').trim()
  const truncated = text.length > maxChars
  return { text: truncated ? text.slice(0, maxChars) : text, truncated }
}

interface XlsxSheet {
  name: string
  rows: string[][]
}

/** Extract sheets as markdown tables (first sheet fully, others summarized). */
export function extractXlsxText(buf: Buffer, maxChars = 60_000): { text: string; truncated: boolean; sheets: XlsxSheet[] } {
  const empty = { text: '', truncated: false, sheets: [] as XlsxSheet[] }
  let shared: Buffer | null
  let workbook: Buffer | null
  try {
    shared = unzipMember(buf, 'xl/sharedStrings.xml')
    workbook = unzipMember(buf, 'xl/workbook.xml')
  } catch {
    return empty
  }
  const strings: string[] = []
  if (shared) {
    const src = shared.toString('utf8')
    const siRe = /<si>([\s\S]*?)<\/si>/g
    let m: RegExpExecArray | null
    while ((m = siRe.exec(src)) !== null) {
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
      let t: RegExpExecArray | null
      let s = ''
      while ((t = tRe.exec(m[1] ?? '')) !== null) s += decodeXmlEntities(t[1] ?? '')
      strings.push(s)
    }
  }
  const sheetNames: string[] = []
  if (workbook) {
    const src = workbook.toString('utf8')
    const shRe = /<sheet[^>]*name="([^"]*)"[^>]*sheetId="(\d+)"|<sheet[^>]*sheetId="(\d+)"[^>]*name="([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = shRe.exec(src)) !== null) sheetNames.push(decodeXmlEntities(m[1] ?? m[4] ?? ''))
  }
  const sheets: XlsxSheet[] = []
  // Read sheets in order (sheet1.xml, sheet2.xml, …) up to a sane bound.
  const sheetCount = Math.max(sheetNames.length, 1)
  for (let i = 1; i <= Math.min(sheetCount, 8); i++) {
    let data: Buffer | null
    try {
      data = unzipMember(buf, `xl/worksheets/sheet${i}.xml`)
    } catch {
      continue
    }
    if (!data) continue
    const src = data.toString('utf8')
    const rows: string[][] = []
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/>/g
    let r: RegExpExecArray | null
    while ((r = rowRe.exec(src)) !== null) {
      if (!r[1]) continue
      const cells: string[] = []
      const cRe = /<c(?:\s[^>]*)?>([\s\S]*?)<\/c>|<c(?:\s[^>]*)?\/>/g
      let c: RegExpExecArray | null
      while ((c = cRe.exec(r[1])) !== null) {
        if (!c[1]) { cells.push(''); continue }
        const full = c[0] ?? ''
        const typeM = /t="([a-zA-Z]+)"/.exec(full)
        const t = typeM?.[1] ?? ''
        const vM = /<v>([\s\S]*?)<\/v>/.exec(c[1])
        if (t === 's' && vM) {
          const idx = parseInt(vM[1] ?? '-1', 10)
          cells.push(strings[idx] ?? '')
        } else if (t === 'inlineStr') {
          const tM = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(c[1])
          cells.push(decodeXmlEntities(tM?.[1] ?? ''))
        } else if (vM) {
          cells.push(decodeXmlEntities(vM[1] ?? ''))
        } else {
          cells.push('')
        }
      }
      // Drop fully-empty trailing rows but keep shape otherwise
      if (cells.some((x) => x !== '')) rows.push(cells)
      if (rows.length >= 500) break
    }
    if (rows.length > 0) sheets.push({ name: sheetNames[i - 1] ?? `Sheet${i}`, rows })
  }
  if (sheets.length === 0) return empty
  const parts: string[] = []
  sheets.forEach((sh, idx) => {
    if (idx === 0) {
      parts.push(`Sheet: ${sh.name}`)
      parts.push(toMarkdownTable(sh.rows))
    } else {
      parts.push(`Sheet: ${sh.name} (${sh.rows.length} rows — open the file for full content)`)
    }
  })
  const text = parts.join('\n\n').trim()
  const truncated = text.length > maxChars
  return { text: truncated ? text.slice(0, maxChars) : text, truncated, sheets }
}

export function toMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const norm = rows.map((r) => {
    const c = [...r]
    while (c.length < width) c.push('')
    return c.map((x) => x.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim())
  })
  const head = norm[0] ?? []
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
  for (const r of norm.slice(1)) lines.push(`| ${r.join(' | ')} |`)
  return lines.join('\n')
}
