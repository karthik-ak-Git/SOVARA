/**
 * attachments — intake for user-attached files (image / pdf / office / text).
 *
 * Renderer sends data: URLs over IPC (bounded by zChatAttachment). Main:
 *  1. decodes + persists the original bytes under sessions/<id>/attachments
 *  2. extracts model-readable content WITHOUT new npm deps:
 *     - text/* → UTF-8 directly
 *     - pdf → bundled content-stream text extractor
 *     - docx/xlsx → bundled OOXML text extractor
 *     - images → header metadata (+ base64 forwarded for vision-capable models)
 *  3. returns capped context strings + an honest manifest line.
 *
 * Anything unparseable is reported as such — never silently dropped, never
 * hallucinated.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getAttachmentsDir } from '../storage/paths'
import { extractPdfText } from './pdfText'
import { extractDocxText, extractXlsxText } from './officeText'
import { getImageDimensions } from './imageMeta'

export interface IncomingAttachment {
  name: string
  mime: string
  size: number
  /** data: URL (base64) as produced by FileReader.readAsDataURL. */
  data: string
}

export type AttachmentKind = 'text' | 'pdf' | 'docx' | 'xlsx' | 'image' | 'other'

export interface ProcessedAttachment {
  name: string
  mime: string
  size: number
  kind: AttachmentKind
  /** Absolute path of the persisted original (null when persistence failed). */
  storedPath: string | null
  /** Model-readable extracted text ('' when none — see note). */
  text: string
  truncated: boolean
  /** Why text is empty (mime rejection, parse failure, scanned PDF…). */
  note: string | null
  /** Vision payload for image attachments (base64 without prefix). */
  imageBase64: string | null
  imageWidth: number | null
  imageHeight: number | null
}

export interface ProcessedAttachments {
  files: ProcessedAttachment[]
  /** One-line manifest for the timeline + logs, e.g. `📎 Attachments (2): …`. */
  manifestLine: string
  totalChars: number
  hasImage: boolean
}

export const MAX_ATTACHMENT_TEXT_PER_FILE = 30_000
export const MAX_ATTACHMENT_TEXT_TOTAL = 90_000

export function sanitizeAttachmentName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 96)
  return base || 'attachment'
}

function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl ?? '')
  if (!m) return null
  const mime = (m[1] ?? 'application/octet-stream').toLowerCase()
  try {
    if (m[2] === ';base64') return { mime, buffer: Buffer.from(m[3] ?? '', 'base64') }
    return { mime, buffer: Buffer.from(decodeURIComponent(m[3] ?? ''), 'utf8') }
  } catch {
    return null
  }
}

function kindOf(name: string, mime: string): AttachmentKind {
  const m = mime.toLowerCase()
  const lower = name.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx')) return 'docx'
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx'
  if (m.startsWith('text/') || m === 'application/json' || /\.(txt|md|markdown|json|csv|log|yaml|yml|xml)$/.test(lower)) return 'text'
  return 'other'
}

export function processAttachments(
  incoming: IncomingAttachment[],
  opts: { sessionId: string; baseDir?: string; persist?: boolean }
): ProcessedAttachments {
  const files: ProcessedAttachment[] = []
  let totalChars = 0
  const dir = getAttachmentsDir(opts.sessionId, opts.baseDir)
  if (opts.persist !== false) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch { /* persistence best-effort; storedPath stays null */ }
  }
  for (const raw of incoming.slice(0, 5)) {
    const name = sanitizeAttachmentName(raw.name)
    const decoded = decodeDataUrl(raw.data)
    if (!decoded) {
      files.push({ name, mime: raw.mime, size: raw.size, kind: 'other', storedPath: null, text: '', truncated: false, note: 'unreadable data URL — file could not be decoded', imageBase64: null, imageWidth: null, imageHeight: null })
      continue
    }
    const kind = kindOf(name, raw.mime || decoded.mime)
    const mime = raw.mime || decoded.mime
    let storedPath: string | null = null
    if (opts.persist !== false) {
      try {
        const target = path.join(dir, `${Date.now()}-${name}`)
        fs.writeFileSync(target, decoded.buffer)
        storedPath = target
      } catch { storedPath = null }
    }
    const base = { name, mime, size: raw.size, kind, storedPath, text: '', truncated: false, note: null as string | null, imageBase64: null as string | null, imageWidth: null as number | null, imageHeight: null as number | null }
    try {
      if (kind === 'text') {
        const t = decoded.buffer.toString('utf8')
        if (t.includes('�') && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)) {
          base.note = 'binary content is not readable as text'
        } else {
          base.text = t
        }
      } else if (kind === 'pdf') {
        const r = extractPdfText(decoded.buffer)
        base.text = r.text
        base.truncated = r.truncated
        if (!r.text) base.note = r.pages > 0 ? 'no extractable text — this PDF looks scanned (image-only)' : 'no extractable text found'
      } else if (kind === 'docx') {
        const r = extractDocxText(decoded.buffer)
        base.text = r.text
        base.truncated = r.truncated
        if (!r.text) base.note = 'no readable paragraphs found'
      } else if (kind === 'xlsx') {
        const r = extractXlsxText(decoded.buffer)
        base.text = r.text
        base.truncated = r.truncated
        if (!r.text) base.note = 'no readable sheets found'
      } else if (kind === 'image') {
        const dims = getImageDimensions(decoded.buffer, mime)
        base.imageWidth = dims?.width ?? null
        base.imageHeight = dims?.height ?? null
        // Cap vision payload at ~6MB raw so a huge photo can't blow the request.
        base.imageBase64 = decoded.buffer.length <= 6 * 1024 * 1024 ? decoded.buffer.toString('base64') : null
        if (!base.imageBase64) base.note = 'image too large to forward to the model — metadata only'
      } else {
        base.note = `type ${mime || 'unknown'} is not readable — attach pdf, office, text or image files`
      }
    } catch {
      base.text = ''
      base.note = 'file could not be parsed'
    }
    // Per-file + global caps (chars beyond the cap are dropped, flagged).
    if (base.text.length > MAX_ATTACHMENT_TEXT_PER_FILE) {
      base.text = base.text.slice(0, MAX_ATTACHMENT_TEXT_PER_FILE)
      base.truncated = true
    }
    if (totalChars + base.text.length > MAX_ATTACHMENT_TEXT_TOTAL) {
      const room = Math.max(0, MAX_ATTACHMENT_TEXT_TOTAL - totalChars)
      base.text = base.text.slice(0, room)
      base.truncated = true
    }
    totalChars += base.text.length
    files.push(base)
  }
  const manifestLine = files.length === 0
    ? ''
    : `📎 Attachments (${files.length}): ${files.map((f) => {
      const bits = [f.name, f.mime]
      if (f.kind === 'image' && f.imageWidth && f.imageHeight) bits.push(`${f.imageWidth}×${f.imageHeight}`)
      if (f.text) bits.push(`~${f.text.length.toLocaleString()} chars extracted${f.truncated ? ' (truncated)' : ''}`)
      else if (f.note) bits.push(f.note)
      return bits.join(' — ')
    }).join(' | ')}`
  return { files, manifestLine, totalChars, hasImage: files.some((f) => f.kind === 'image') }
}

/**
 * Build advisory system messages carrying the extracted file content.
 * `visionCapable` decides whether images ride as real vision input or as an
 * honest metadata-only note (never pretend the model sees pixels it can't).
 */
export function buildAttachmentContext(files: ProcessedAttachment[], visionCapable: boolean): string[] {
  const out: string[] = []
  for (const f of files) {
    if (f.kind === 'image') {
      const dims = f.imageWidth && f.imageHeight ? `, ${f.imageWidth}×${f.imageHeight}px` : ''
      if (visionCapable && f.imageBase64) {
        out.push(`Attached image "${f.name}" (${f.mime}${dims}) is provided as vision input with the user message. Describe or analyze what you actually see in it.`)
      } else {
        out.push(`Attached image "${f.name}" (${f.mime}${dims}). IMPORTANT: the current model has no vision support — you CANNOT see this image's pixels, only this metadata. Do not describe its contents. If the user's question needs the image content, say so plainly and ask them to describe it or switch to a vision-capable model.`)
      }
      continue
    }
    if (f.text) {
      out.push(`--- Attached file: ${f.name} (${f.mime}) ---\n${f.text}\n--- end of ${f.name}${f.truncated ? ' (truncated)' : ''} ---`)
    } else {
      out.push(`--- Attached file: ${f.name} (${f.mime}) — NOT readable: ${f.note ?? 'no content extracted'}. Tell the user plainly instead of guessing. ---`)
    }
  }
  return out
}
