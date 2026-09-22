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

export type ArtifactKind = 'pdf' | 'xlsx' | 'docx' | 'pptx' | 'code'

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
  // Ignore compiler/browser error messages and stack traces (e.g. "react-dom.development.js:29905 ...")
  // so they are treated as debugging input rather than requests to create a file with that name.
  const isStackTraceOrLog = /^[A-Za-z0-9_.-]+\.[a-z]{2,4}:\d+/m.test(text.trim()) ||
    /\b(?:Uncaught|TypeError|SyntaxError|ReferenceError|at\s+\S+|line\s+\d+|:\d+:\d+)\b/i.test(text)

  // 1. Explicit filename with a known extension wins (only if not a stack trace/log paste).
  const fileRe = /([A-Za-z0-9 _\-][A-Za-z0-9 _\-.]{0,90}\.(pdf|xlsx?|docx?|pptx?|csv|py|ts|tsx|js|jsx|mjs|rs|go|java|kt|c|cpp|h|hpp|cs|rb|php|swift|html|css|json|ya?ml|xml|md|txt|sh|ps1|sql|r|lua|toml|vue|svelte))\b/i
  const fileM = !isStackTraceOrLog ? fileRe.exec(text) : null
  if (fileM) {
    const raw = fileM[1]!.trim()
    const ext = (fileM[2] ?? '').toLowerCase()
    if (ext === 'pdf') return { kind: 'pdf', fileName: sanitizeFileName(raw, 'sovara-output.pdf'), explicitName: true }
    if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return { kind: 'xlsx', fileName: sanitizeFileName(raw.replace(/\.(xls|csv)$/i, '.xlsx'), 'sovara-output.xlsx'), explicitName: true }
    if (ext === 'doc' || ext === 'docx') return { kind: 'docx', fileName: sanitizeFileName(raw.replace(/\.doc$/i, '.docx'), 'sovara-output.docx'), explicitName: true }
    if (ext === 'ppt' || ext === 'pptx') return { kind: 'pptx', fileName: sanitizeFileName(raw.replace(/\.ppt$/i, '.pptx'), 'sovara-output.pptx'), explicitName: true }
    if (CODE_EXTS.includes(ext)) return { kind: 'code', fileName: sanitizeFileName(raw, `sovara-output.${ext}`), explicitName: true }
  }
  // 2. Generate/export/save verb aimed at a document kind — scan FULL prompt, not just 400ch head.
  const scan = text.toLowerCase()
  const wantsPptx = /\b(generate|create|make|export|save|download|produce|write|build)\b[^.\n]{0,80}\b(ppt|pptx|presentation|slide deck|slides|powerpoint)\b/i.test(text) || /\b(ppt|pptx|presentation|slide deck|powerpoint) (file|document|export|download|deck)\b/i.test(text)
  if (wantsPptx) return { kind: 'pptx', fileName: `${slugify(text.slice(0,120))}.pptx`, explicitName: false }
  const wantsPdf = /\b(generate|create|make|export|save|download|produce|write|build)\b[^.\n]{0,80}\b(pdf|a pdf|as pdf|into pdf)\b/i.test(text) || /\bpdf (file|document|report|export|download)\b/i.test(text) || (/\b(pdf)\b/i.test(scan) && /\b(report|invoice|resume|document|file)\b/i.test(scan))
  if (wantsPdf) return { kind: 'pdf', fileName: `${slugify(text.slice(0,120))}.pdf`, explicitName: false }
  const wantsXlsx = /\b(generate|create|make|export|save|download|produce|write|build)\b[^.\n]{0,80}\b(excel|spreadsheet|xlsx?|workbook|sheet)\b/i.test(text) || /\b(excel|spreadsheet) (file|sheet|export|download|report|table)\b/i.test(text) || /\b(table|data).*\b(excel|xlsx|spreadsheet)\b/i.test(text)
  if (wantsXlsx) return { kind: 'xlsx', fileName: `${slugify(text.slice(0,120))}.xlsx`, explicitName: false }
  const wantsDocx = /\b(generate|create|make|export|save|download|produce|write|build)\b[^.\n]{0,80}\b(word|docx?|document file)\b/i.test(text) || /\b(word) (file|document|export|download)\b/i.test(text)
  if (wantsDocx) return { kind: 'docx', fileName: `${slugify(text.slice(0,120))}.docx`, explicitName: false }
  // 3. Code file — only trigger if the user explicitly asked to save to a specific filename
  const codeFileM = /\b(save|write|create|generate|export)(?: it| this| the code)? (?:as|to|into) ([A-Za-z0-9 _\-.]+\.(py|ts|tsx|js|jsx|rs|go|java|html|css|json|sh|sql))\b/i.exec(text)
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

/** Parse markdown or generated python-pptx code into structured presentation slides. */
export function markdownToSlides(text: string): Array<{ title: string; bullets: string[] }> {
  const slides: Array<{ title: string; bullets: string[] }> = []

  // 1. If text contains python-pptx slide calls, extract titles and body text directly
  const pythonSlideRe = /add_slide[\s\S]*?(?:title\.text|shapes\.title\.text)\s*=\s*["']([^"']+)["']([\s\S]*?)(?=add_slide|$)/g
  let pm: RegExpExecArray | null
  while ((pm = pythonSlideRe.exec(text)) !== null) {
    const title = pm[1]!.trim()
    const block = pm[2] || ''
    const bullets: string[] = []
    const paraRe = /(?:add_paragraph|text)\s*=\s*["']([^"']+)["']/g
    let tm: RegExpExecArray | null
    while ((tm = paraRe.exec(block)) !== null) {
      const b = tm[1]!.trim()
      if (b && !bullets.includes(b)) bullets.push(b)
    }
    slides.push({ title, bullets: bullets.length > 0 ? bullets : ['Key point overview'] })
  }
  if (slides.length >= 2) return slides

  // 2. Parse standard markdown headers and lists
  const lines = text.split('\n')
  let curTitle = ''
  let curBullets: string[] = []

  const flush = (): void => {
    if (curTitle) {
      slides.push({
        title: curTitle,
        bullets: curBullets.length > 0 ? curBullets : ['Key point overview'],
      })
      curTitle = ''
      curBullets = []
    }
  }

  for (const raw of lines) {
    const l = raw.trim()
    if (!l) continue
    if (/^```/.test(l)) continue

    const headerMatch = /^(?:#{1,3}\s+|(?:\*{1,2})?Slide\s+\d+:?\s*(?:\*{1,2})?)(.+)$/i.exec(l)
    if (headerMatch) {
      flush()
      curTitle = headerMatch[1]!.replace(/[*_`#]/g, '').trim()
      continue
    }

    const bulletMatch = /^(?:[-*•+]|\d+[.)])\s+(.+)$/.exec(l)
    if (bulletMatch) {
      const b = bulletMatch[1]!.replace(/[*_`]/g, '').trim()
      if (b) curBullets.push(b)
      continue
    }

    if (!curTitle && l.length < 100 && !l.startsWith('import ') && !l.startsWith('def ')) {
      curTitle = l.replace(/[*_`#]/g, '').trim()
    } else if (curTitle && l.length > 10 && !l.startsWith('import ') && !l.startsWith('def ')) {
      curBullets.push(l.replace(/[*_`]/g, '').trim())
    }
  }
  flush()

  if (slides.length === 0) {
    slides.push({
      title: 'Presentation',
      bullets: markdownToParagraphs(text).slice(0, 6),
    })
  }
  return slides
}

/** Minimal valid OpenXML .pptx presentation (16:9 widescreen, clean typographic theme). */
export function writePptxFile(filePath: string, slides: Array<{ title: string; bullets: string[] }>): void {
  const slideParts: Array<{ name: string; data: string }> = []
  const contentTypesSlides: string[] = []
  const presentationRels: string[] = []
  const presentationSlideList: string[] = []

  presentationRels.push(
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
  )

  slides.forEach((slide, idx) => {
    const sId = idx + 1
    const rId = `rId${sId + 1}`
    contentTypesSlides.push(`<Override PartName="/ppt/slides/slide${sId}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    presentationRels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${sId}.xml"/>`)
    presentationSlideList.push(`<p:sldId id="${255 + sId}" r:id="${rId}"/>`)

    const bulletXml = slide.bullets.map((b) => `
      <a:p>
        <a:pPr lvl="0"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>
        <a:r>
          <a:rPr lang="en-US" sz="1800"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:rPr>
          <a:t>${escapeXml(b)}</a:t>
        </a:r>
      </a:p>`).join('')

    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="838200" y="685800"/><a:ext cx="10515600" cy="1143000"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr lang="en-US" sz="3200" b="1"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill></a:rPr>
              <a:t>${escapeXml(slide.title)}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="838200" y="2057400"/><a:ext cx="10515600" cy="4343400"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          ${bulletXml}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`

    slideParts.push({ name: `ppt/slides/slide${sId}.xml`, data: slideXml })
    slideParts.push({
      name: `ppt/slides/_rels/slide${sId}.xml.rels`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
    })
  })

  const parts: Array<{ name: string; data: string }> = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  ${contentTypesSlides.join('\n  ')}
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    },
    {
      name: 'ppt/presentation.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${presentationSlideList.join('')}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${presentationRels.join('\n  ')}
</Relationships>`,
    },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`,
    },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
    },
    {
      name: 'ppt/slideLayouts/slideLayout1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="titleAndContent">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
</p:sldLayout>`,
    },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
    },
    ...slideParts,
  ]

  fs.writeFileSync(filePath, createZip(parts))
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
  } else if (kind === 'pptx') {
    const slides = markdownToSlides(text)
    writePptxFile(filePath, slides)
  } else {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const block = extractCodeBlock(text, ext || undefined)
    const content = block ? `${block.code}\n` : `${text}\n`
    fs.writeFileSync(filePath, content, 'utf8')
  }
  const stat = fs.statSync(filePath)
  return { path: filePath, bytes: stat.size }
}
