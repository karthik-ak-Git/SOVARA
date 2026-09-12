/**
 * imageMeta — dependency-free image dimension parsing.
 * Supports PNG, JPEG, GIF and WebP (VP8 / VP8L / VP8X). Returns null when
 * the header is unreadable — callers treat that as "dimensions unknown",
 * never as a reason to reject the file.
 */

export interface ImageDimensions {
  width: number
  height: number
}

function sane(w: number, h: number): ImageDimensions | null {
  if (!Number.isInteger(w) || !Number.isInteger(h)) return null
  if (w <= 0 || h <= 0 || w > 100_000 || h > 100_000) return null
  return { width: w, height: h }
}

function png(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null
  if (buf.readUInt32BE(12) !== 0x49484452) return null // IHDR
  return sane(buf.readUInt32BE(16), buf.readUInt32BE(20))
}

function gif(buf: Buffer): ImageDimensions | null {
  if (buf.length < 10) return null
  return sane(buf.readUInt16LE(6), buf.readUInt16LE(8))
}

function jpeg(buf: Buffer): ImageDimensions | null {
  let off = 2
  const n = buf.length
  while (off + 4 <= n) {
    if (buf[off] !== 0xff) return null
    const marker = buf[off + 1]!
    if (marker === 0xd8 || marker === 0xd9) { off += 2; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue }
    const len = buf.readUInt16BE(off + 2)
    if (len < 2) return null
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (off + 9 > n) return null
      return sane(buf.readUInt16BE(off + 7), buf.readUInt16BE(off + 5))
    }
    off += 2 + len
  }
  return null
}

function webp(buf: Buffer): ImageDimensions | null {
  if (buf.length < 12 || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8 ') {
    if (buf.length < 30) return null
    const w = buf.readUInt16LE(26) & 0x3fff
    const h = buf.readUInt16LE(28) & 0x3fff
    return sane(w, h)
  }
  if (fourcc === 'VP8L') {
    if (buf.length < 25) return null
    const b0 = buf[21]!, b1 = buf[22]!, b2 = buf[23]!, b3 = buf[24]!
    const w = 1 + (((b1 & 0x3f) << 8) | b0)
    const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    return sane(w, h)
  }
  if (fourcc === 'VP8X') {
    if (buf.length < 30) return null
    const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16))
    const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16))
    return sane(w, h)
  }
  return null
}

export function getImageDimensions(buf: Buffer, mime: string): ImageDimensions | null {
  try {
    const m = mime.toLowerCase()
    if (m === 'image/png') return png(buf)
    if (m === 'image/jpeg' || m === 'image/jpg') return jpeg(buf)
    if (m === 'image/gif') return gif(buf)
    if (m === 'image/webp') return webp(buf)
    // Unknown mime — sniff by magic bytes
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return png(buf)
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return jpeg(buf)
    if (buf.length >= 6 && buf.toString('ascii', 0, 6).startsWith('GIF')) return gif(buf)
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') return webp(buf)
    return null
  } catch {
    return null
  }
}
