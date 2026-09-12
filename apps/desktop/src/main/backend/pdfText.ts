/**
 * pdfText — dependency-free text extraction from text-based PDFs.
 *
 * Strategy: locate `stream … endstream` blocks, inflate FlateDecode streams
 * with node:zlib, then walk the content-stream text operators (Tj, TJ, ',
 * ") collecting literal `(…)` and hex `<…>` strings in order. WinAnsi bytes
 * map to Unicode (ASCII passes through; 0x80–0x9F use the WinAnsi table).
 *
 * Scanned/image-only PDFs yield no text — callers must say so honestly
 * instead of inventing content. Encrypted or ASCII85-only files are skipped
 * block-by-block (best-effort, never throws on malformed input).
 */

import { inflateSync } from 'node:zlib'

export interface PdfExtractResult {
  text: string
  pages: number
  truncated: boolean
}

/** WinAnsi 0x80–0x9F → Unicode (rest of WinAnsi == Latin-1). */
const WINANSI_EXTRA: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
}

function decodeBytes(bytes: number[]): string {
  let out = ''
  for (const b of bytes) {
    if (b < 0x80) out += String.fromCharCode(b)
    else if (WINANSI_EXTRA[b] !== undefined) out += WINANSI_EXTRA[b]
    else out += String.fromCharCode(b) // Latin-1 upper half
  }
  return out
}

/** Split a content stream into tokens: literal strings, hex strings, arrays, names, words. */
function tokenize(src: string): string[] {
  const tokens: string[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\0') { i++; continue }
    if (ch === '%') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; continue }
    if (ch === '(') {
      // literal string with nesting + backslash escapes
      let depth = 1
      const bytes: number[] = []
      i++
      while (i < n && depth > 0) {
        const c = src[i]!
        if (c === '\\') {
          const nx = src[i + 1]
          if (nx === undefined) break
          if (nx === 'n') bytes.push(0x0a)
          else if (nx === 'r') bytes.push(0x0d)
          else if (nx === 't') bytes.push(0x09)
          else if (nx === 'b') bytes.push(0x08)
          else if (nx === 'f') bytes.push(0x0c)
          else if (nx === '(') bytes.push(0x28)
          else if (nx === ')') bytes.push(0x29)
          else if (nx === '\\') bytes.push(0x5c)
          else if (nx >= '0' && nx <= '7') {
            const oct = src.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? ''
            bytes.push(parseInt(oct, 8) & 0xff)
            i += oct.length
          } else if (nx === '\n') { /* line continuation: ignore */ } else if (nx === '\r') { if (src[i + 2] === '\n') i++ }
          else bytes.push(nx.charCodeAt(0) & 0xff)
          i += 2
          continue
        }
        if (c === '(') depth++
        else if (c === ')') { depth--; if (depth === 0) { i++; break } }
        if (depth > 0) bytes.push(c.charCodeAt(0) & 0xff)
        i++
      }
      // Strip UTF-16BE BOM when present
      let text: string
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        const chars: string[] = []
        for (let k = 2; k + 1 < bytes.length; k += 2) chars.push(String.fromCharCode((bytes[k]! << 8) | bytes[k + 1]!))
        text = chars.join('')
      } else {
        text = decodeBytes(bytes)
      }
      tokens.push(`\u0001${text}`)
      continue
    }
    if (ch === '<' && src[i + 1] === '<') { tokens.push('<<'); i += 2; continue }
    if (ch === '>' && src[i + 1] === '>') { tokens.push('>>'); i += 2; continue }
    if (ch === '<') {
      let hex = ''
      i++
      while (i < n && src[i] !== '>') {
        const h = src[i]!
        if (/[0-9a-fA-F]/.test(h)) hex += h
        i++
      }
      i++ // consume '>'
      if (hex.length % 2 === 1) hex += '0'
      const bytes: number[] = []
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16))
      let text: string
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        const chars: string[] = []
        for (let k = 2; k + 1 < bytes.length; k += 2) chars.push(String.fromCharCode((bytes[k]! << 8) | bytes[k + 1]!))
        text = chars.join('')
      } else {
        text = decodeBytes(bytes)
      }
      tokens.push(`\u0001${text}`)
      continue
    }
    if (ch === '[') { tokens.push('['); i++; continue }
    if (ch === ']') { tokens.push(']'); i++; continue }
    if (ch === '/') {
      let j = i + 1
      while (j < n && !/[\s<>()[\]{}/%]/.test(src[j]!)) j++
      tokens.push(`/${src.slice(i + 1, j)}`)
      i = j
      continue
    }
    let j = i
    while (j < n && !/[\s<>()[\]{}/%]/.test(src[j]!)) j++
    tokens.push(src.slice(i, j))
    i = j
  }
  return tokens
}

/** Collect shown strings from one content stream, preserving line breaks. */
function extractStreamText(src: string): string {
  const tokens = tokenize(src)
  const lines: string[] = []
  let line = ''
  const flush = (): void => {
    const t = line.replace(/[ \t]+/g, ' ').trim()
    if (t) lines.push(t)
    line = ''
  }
  const strOf = (tok: string): string | null => (tok.charCodeAt(0) === 1 ? tok.slice(1) : null)
  const stack: string[] = []
  for (const tok of tokens) {
    if (tok === '[') { stack.push(tok); continue }
    if (tok === ']') {
      // TJ array: concatenate string members, ignore kerning numbers
      const parts: string[] = []
      while (stack.length > 0) {
        const t = stack.pop()!
        if (t === '[') break
        const s = strOf(t)
        if (s !== null) parts.unshift(s)
      }
      line += parts.join('')
      continue
    }
    if (tok === 'Tj' || tok === "'" || tok === '"') {
      const top = stack.pop()
      const s = top !== undefined ? strOf(top) : null
      if (s !== null) line += s
      if (tok === "'" || tok === '"') flush()
      continue
    }
    if (tok === 'TJ') {
      const top = stack.pop()
      if (top !== undefined) {
        // Single string TJ (non-array form)
        const s = strOf(top)
        if (s !== null) line += s
      }
      continue
    }
    if (tok === 'ET' || tok === 'Td' || tok === 'TD' || tok === 'Tm' || tok === 'T*') {
      flush()
      continue
    }
    stack.push(tok)
    if (stack.length > 64) stack.shift() // never grow unbounded on weird streams
  }
  flush()
  return lines.join('\n')
}

export function extractPdfText(buf: Buffer, maxChars = 60_000): PdfExtractResult {
  const raw = buf.toString('latin1')
  // Page count: /Type /Page not followed by 's' (avoids /Pages)
  const pages = (raw.match(/\/Type\s*\/Page(?!s)/g) ?? []).length
  const blocks: string[] = []
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g
  let m: RegExpExecArray | null
  while ((m = streamRe.exec(raw)) !== null) {
    const dictStart = Math.max(0, m.index - 400)
    const dict = raw.slice(dictStart, m.index)
    const isFlate = /\/FlateDecode/.test(dict)
    const isImage = /\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode/.test(dict)
    if (isImage && !isFlate) continue
    let content: string | null = null
    const payload = Buffer.from(m[1] ?? '', 'latin1')
    if (isFlate) {
      try {
        content = inflateSync(payload).toString('latin1')
      } catch {
        continue // corrupt stream — skip block, keep others
      }
    } else {
      // Unfiltered content stream (rare) — treat bytes as latin1
      content = payload.toString('latin1')
    }
    if (!content || !/BT[\s]/.test(content)) continue
    blocks.push(content)
  }
  const text = blocks.map(extractStreamText).filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  const truncated = text.length > maxChars
  return { text: truncated ? text.slice(0, maxChars) : text, pages, truncated }
}
