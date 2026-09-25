/**
 * Coalesces runs of fragmented words/phrases caused by tokenization or
 * double-newline streaming output from local LLMs into natural prose sentences.
 */
export function coalesceFragmentedProse(s: string): string {
  if (!s) return ''
  const isNonProseLine = (t: string) => {
    return /^```|^[-*]\s+|^\d+\.\s+|^#{1,6}\s+|^>|^\|/.test(t)
  }

  // Pass 1: Coalesce short lines within each paragraph (e.g. single-newline words)
  const rawParagraphs = s.split(/\r?\n\r?\n/)
  const coalescedParas = rawParagraphs.map((p) => {
    const lines = p.split(/\r?\n/)
    if (lines.length < 3) return p
    let shortProse = 0
    let nonProse = 0
    for (const l of lines) {
      const t = l.trim()
      if (!t) continue
      if (isNonProseLine(t)) {
        nonProse++
        continue
      }
      if (t.length <= 80) shortProse++
    }
    if (shortProse >= 3 && shortProse >= (shortProse + nonProse) * 0.6) {
      return lines.map((l) => l.trim()).filter(Boolean).join(' ')
    }
    return p
  })

  // Pass 2: Coalesce runs of single-word or short-phrase paragraphs (e.g. double-newline words)
  const outParas: string[] = []
  let run: string[] = []

  const flushRun = () => {
    if (run.length === 0) return
    if (run.length >= 3) {
      outParas.push(run.join(' ').replace(/\s+([.,;:!?])/g, '$1'))
    } else {
      outParas.push(...run)
    }
    run = []
  }

  for (const para of coalescedParas) {
    const trimmed = para.trim()
    if (!trimmed) {
      flushRun()
      continue
    }
    const isSingleShortPara = !trimmed.includes('\n') && trimmed.length <= 40 && !isNonProseLine(trimmed)
    if (isSingleShortPara) {
      run.push(trimmed)
    } else {
      flushRun()
      outParas.push(para)
    }
  }
  flushRun()

  return outParas.join('\n\n')
}
