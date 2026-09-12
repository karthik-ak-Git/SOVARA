/**
 * artifacts — required-output generation driven by the user's instruction.
 *
 * `detectOutputFormat(userContent)` is deterministic: it fires only on an
 * explicit file request (a filename with a known extension, or a
 * generate/export/save verb aimed at pdf / excel / word). Anything else is
 * chat — the model answers in the timeline as usual.
 *
 * All writers are dependency-free: minimal PDF 1.4, and .xlsx / .docx built
 * on the bundled mini-zip writer. Tables in the reply become spreadsheet
 * sheets; headings/paragraphs become document structure; fenced code blocks
 * become code files.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createZip } from './minizip'

export type ArtifactKind = 'pdf' | 'xlsx' | 'docx' | 'code'

export interface DetectedOutput {
  kind: ArtifactKind
  /** Sanitized file name (with extension). */
  fileName: string
  /** True when the user named the file explicitly. */
  explicitName: boolean
}

const CODE_EXTS = ['py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'go', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'html', 'css', 'scss', 'json', 'yaml', 'yml', 'xml', 'md', 'txt', 'sh', 'ps1', 'bat', 'sql', 'r', 'lua', 'toml', 'ini', 'cfg', 'vue', 'svelte']

export function sanitizeFileName(name: string, fallback: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 96)
  return base || fallback
}

function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return s || 'sovara-output'
}

/**
 * Detect an explicit required-output instruction in the USER prompt.
 * Returns null for ordinary chat (no file requested).
 */
export function detectOutputFormat(content: string): DetectedOutput | null {
  const text = content ?? ''
  // 1. Explicit filename with a known extension wins.
  const fileRe = /([A-Za-z0-9 _\-][A-Za-z0-9 _\-.]{0,90}\.(pdf|xlsx?|docx?|csv|py|ts|tsx|js|jsx|mjs|rs|go|java|kt|c|cpp|h|hpp|cs|rb|php|swift|html|css|json|ya?ml|xml|md|txt|sh|ps1|sql|r|lua|toml|vue|svelte))\b/i
  const fileM = fileRe.exec(text)
  if (fileM) {
    const raw = fileM[1]!.trim()
    const ext = (fileM[2] ?? '').toLowerCase()
    if (ext === 'pdf') return { kind: 'pdf', fileName: sanitizeFileName(raw, 'sovara-output.pdf'), explicitName: true }
    if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return { kind: 'xlsx', fileName: sanitizeFileName(raw.replace(/\.(xls|csv)$/i, '.xlsx'), 'sovara-output.xlsx'), explicitName: true }
    if (ext === 'doc' || ext === 'docx') return { kind: 'docx', fileName: sanitizeFileName(raw.replace(/\.doc$/i, '.docx'), 'sovara-output.docx'), explicitName: true }
    if (CODE_EXTS.includes(ext)) return { kind: 'code', fileName: sanitizeFileName(raw, `sovara-output.${ext}`), explicitName: true }
  }
  // 2. Generate/export/save verb aimed at a document kind.
  const head = text.slice(0, 400)
  const wantsPdf = /\b(generate|create|make|export|save|download|produce|write|build)\b[^.\n]{0,60}\b(pdf|a pdf|as pdf|into pdf)\b/i.test(head) || /\bpdf (file|document|report|export|download)\b/i.test(head)
  if (wantsPdf) return { kind: 'pdf', fileName: `${slugify(head)}.pdf`, explicitName: false }
  const wantsXlsx = /\b(generate|create|make|export|save|download|produce|write|build)\b[^.\n]{0,60}\b(excel|spreadsheet|xlsx?|workbook)\b/i.test(head) || /\bexcel (file|sheet|export|download|report)\b/i.test(head)
  if (wantsXlsx) return { kind: 'xlsx', fileName: `${slugify(head)}.xlsx`, explicitName: false }
  const wantsDocx = /\b(generate|create|make|export|save|download|produce|write|build)\b[^.\n]{0,60}\b(word|docx?|document file)\b/i.test(head) || /\bword (file|document|export|download)\b/i.test(head)
  if (wantsDocx) return { kind: 'docx', fileName: `${slugify(head)}.docx`, explicitName: false }
  // 3. Code file with an explicit language + save/write verb (chat fences alone don't count —
  //    the artifact panel already surfaces those; a FILE needs a named target).
  const codeFileM = /\b(save|write|create|generate|export)(?: it| this| the code)? (?:as|to|into) ([A-Za-z0-9 _\-.]+\.(py|ts|tsx|js|jsx|rs|go|java|html|css|json|sh|sql))\b/i.exec(head)
  if (codeFileM) return { kind: 'code', fileName: sanitizeFileName(codeFileM[1]!.trim(), 'script.txt'), explicitName: true }
  return null
}

/** First fenced block, preferring the requested language. */
export function extractCodeBlock(text: string, preferredLang?: string): { lang: string; code: string } | null {
  const re = /```([a-zA-Z0-9_+\-#]*)\n([\s\S]*?)```/g
  const blocks: Array<{ lang: string; code: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) blocks.push({ lang: (m[1] ?? '').trim().toLowerCase(), code: (m[2] ?? '').replace(/\s+$/, '') })
  if (blocks.length === 0) return null
  if (preferredLang) {
    const hit = blocks.find((b) => b.lang === preferredLang.toLowerCase())
    if (hit) return hit
  }
  return blocks[0] ?? null
}

/** Markdown tables → sheets. Falls back to one sheet of raw lines. */
export function markdownToSheets(text: string): Array<{ name: string; rows: string[][] }> {
  const sheets: Array<{ name: string; rows: string[][] }> = []
  const lines = text.split('\n')
  let cur: string[][] = []
  const flush = (idx: number): void => {
    if (cur.length === 0) return
    sheets.push({ name: sheets.length === 0 ? 'Sheet1' : `Sheet${sheets.length + 1}`, rows: cur })
    cur = []
    void idx
  }
  for (const line of lines) {
    const t = line.trim()
    if (/^\|.*\|\s*$/.test(t)) {
      const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      if (/^:?-+:?$/.test(cells[0] ?? '') && cells.every((c) => /^:?-+:?$/.test(c))) continue // separator row
      cur.push(cells.map((c) => c.replace(/\\\|/g, '|').replace(/[*_`~]/g, '')))
    } else if (cur.length > 0 && t === '') {
      flush(0)
    }
  }
  flush(0)
  if (sheets.length === 0) {
    const rows = text.split('\n').map((l) => [l.slice(0, 32767)])
    sheets.push({ name: 'Content', rows: rows.length > 0 ? rows : [['']] })
  }
  return sheets
}

/** Markdown → plain paragraphs (headings kept as lead lines, markup stripped). */
export function markdownToParagraphs(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const t = raw.trim()
    if (!t) continue
    if (/^```/.test(t)) continue
    const clean = t
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+/, '• ')
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/[*_`~]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    if (clean) out.push(clean)
  }
  return out
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** Minimal multi-page PDF 1.4 (Helvetica only — always available). */
export function writePdfFile(filePath: string, title: string, bodyText: string): void {
  const paras = markdownToParagraphs(`${title}\n\n${bodyText}`)
  const lines: string[] = []
  for (const p of paras) {
    let rest = p
    while (rest.length > 0) {
      lines.push(rest.slice(0, 95))
      rest = rest.slice(95)
    }
    lines.push('') // paragraph gap
  }
  const PAGE_W = 595
  const TOP = 786
  const LEADING = 14
  const perPage = Math.floor((TOP - 56) / LEADING)
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage))
  if (pages.length === 0) pages.push([''])
  // Object numbering: 1 catalog, 2 pages, then per-page (page, content) pairs, then fonts.
  const kids: number[] = []
  const objs: string[] = []
  let objNo = 3
  const pageObjNos: number[] = []
  for (const pageLines of pages) {
    const pageNo = objNo++
    const contentNo = objNo++
    pageObjNos.push(pageNo)
    kids.push(pageNo)
    let ops = 'BT /F1 11 Tf 14 TL 56 786 Td\n'
    const esc = pageLines.map((l) => `(${escapePdf(l)}) Tj T*`).join('\n')
    ops += `${esc}\nET`
    objs.push(`${pageNo} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} 842] /Resources << /Font << /F1 ${objNo} 0 R /F2 ${objNo + 1} 0 R >> >> /Contents ${contentNo} 0 R >>\nendobj`)
    objs.push(`${contentNo} 0 obj\n<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream\nendobj`)
  }
  const f1 = objNo++
  const f2 = objNo++
  objs.push(`${f1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`)
  objs.push(`${f2} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`)
  void pageObjNos
  const header = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const catalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'
  const pagesObj = `2 0 obj\n<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>\nendobj`
  const all = [catalog, pagesObj, ...objs]
  let offset = Buffer.byteLength(header, 'latin1')
  const offsets: number[] = []
  const parts: string[] = [header]
  for (const o of all) {
    offsets.push(offset)
    parts.push(o + '\n')
    offset += Buffer.byteLength(o + '\n', 'latin1')
  }
  const xrefAt = offset
  parts.push(`xref\n0 ${all.length + 1}\n0000000000 65535 f \n`)
  for (const o of offsets) parts.push(`${String(o).padStart(10, '0')} 00000 n \n`)
  parts.push(`trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`)
  fs.writeFileSync(filePath, parts.join(''), 'latin1')
}

/** Minimal .xlsx: shared strings + N sheets, string/number cells. */
export function writeXlsxFile(filePath: string, sheets: Array<{ name: string; rows: string[][] }>): void {
  const strIndex = new Map<string, number>()
  const shared: string[] = []
  const sref = (s: string): number => {
    const hit = strIndex.get(s)
    if (hit !== undefined) return hit
    const i = shared.length
    shared.push(s)
    strIndex.set(s, i)
    return i
  }
  const isNum = (s: string): boolean => s !== '' && /^-?\d+(\.\d+)?$/.test(s.trim())
  const colName = (i: number): string => {
    let n = i
    let s = ''
    do {
      s = String.fromCharCode(65 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
  }
  const sheetXml = sheets.map((sh, si) => {
    const cells = sh.rows.slice(0, 10000).map((row, ri) => {
      const tds = row.slice(0, 64).map((cell, ci) => {
        const ref = `${colName(ci)}${ri + 1}`
        if (isNum(cell)) return `<c r="${ref}"><v>${cell.trim()}</v></c>`
        return `<c r="${ref}" t="s"><v>${sref(cell)}</v></c>`
      }).join('')
      return `<row r="${ri + 1}">${tds}</row>`
    }).join('')
    return {
      name: sh.name.slice(0, 31) || `Sheet${si + 1}`,
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`,
    }
  })
  const parts: Array<{ name: string; data: string }> = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetXml.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetXml.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheetXml.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${sheetXml.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('')}</sst>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>` },
    ...sheetXml.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
  ]
  fs.writeFileSync(filePath, createZip(parts.map((p) => ({ name: p.name, data: p.data }))))
}

/** Minimal .docx: title heading + paragraphs. */
export function writeDocxFile(filePath: string, title: string, paragraphs: string[]): void {
  const para = (t: string, style?: string): string =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`
  const body = [para(title.slice(0, 200) || 'Sovara document', 'Heading1'), ...paragraphs.flatMap((p) => {
    const chunks: string[] = []
    let rest = p
    while (rest.length > 0) { chunks.push(rest.slice(0, 2000)); rest = rest.slice(2000) }
    return chunks.length > 0 ? chunks.map((c) => para(c)) : []
  })].join('')
  const parts = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'word/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style></w:styles>` },
  ]
  fs.writeFileSync(filePath, createZip(parts.map((p) => ({ name: p.name, data: p.data }))))
}

export interface GeneratedArtifact {
  path: string
  bytes: number
}

/**
 * Write the artifact for a detected output request, derived from the
 * assistant's final reply text. Returns null when nothing sensible can be
 * built (caller then skips the artifact honestly — chat reply stands).
 */
export function generateArtifactFile(kind: ArtifactKind, filePath: string, assistantText: string, userContent: string): GeneratedArtifact | null {
  const text = (assistantText ?? '').trim()
  if (!text) return null
  if (kind === 'pdf') {
    const title = userContent.trim().split('\n')[0]?.slice(0, 120) ?? 'Sovara output'
    writePdfFile(filePath, title, text)
  } else if (kind === 'xlsx') {
    const sheets = markdownToSheets(text)
    writeXlsxFile(filePath, sheets)
  } else if (kind === 'docx') {
    const title = userContent.trim().split('\n')[0]?.slice(0, 120) ?? 'Sovara document'
    writeDocxFile(filePath, title, markdownToParagraphs(text))
  } else {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const block = extractCodeBlock(text, ext || undefined)
    const content = block ? `${block.code}\n` : `${text}\n`
    fs.writeFileSync(filePath, content, 'utf8')
  }
  const stat = fs.statSync(filePath)
  return { path: filePath, bytes: stat.size }
}
