/**
 * previewBundler.ts — Resolves and inlines local workspace assets (CSS, JS)
 * into self-contained HTML for reliable artifact preview in sandboxed iframes.
 *
 * Solves the issue where <script src="main.js"> or <link rel="stylesheet" href="style.css">
 * fails with MIME type checking errors against Vite dev server (http://localhost:5173/main.js).
 */

export async function preparePreviewHtml(
  html: string,
  sessionEvents?: Array<{ type: string; data: unknown }>,
  sessionId?: string
): Promise<string> {
  if (!html || typeof html !== 'string') return ''
  let bundled = html

  // Helper to read file content from workspace via IPC, or fallback to session events
  const readFile = async (relPath: string): Promise<string | null> => {
    const clean = relPath.replace(/^\.\//, '').trim()

    // 1. Try reading directly from workspace via tools:dispatch fs_read
    try {
      if (window.sovara?.invoke) {
        const resp = (await window.sovara.invoke('tools:dispatch', {
          name: 'fs_read',
          args: { path: clean, _forceApprove: true, ...(sessionId ? { sessionId } : {}) }
        })) as { ok?: boolean; result?: string | Record<string, unknown> }

        if (resp?.result) {
          const parsed =
            typeof resp.result === 'string'
              ? JSON.parse(resp.result)
              : resp.result
          if (parsed && typeof parsed.content === 'string' && parsed.content.trim()) {
            return parsed.content
          }
        }
      }
    } catch {
      // Fall through to session event search
    }

    // 2. Fallback: Search recent session events for code fences matching the file extension or name
    if (sessionEvents && Array.isArray(sessionEvents)) {
      for (let i = sessionEvents.length - 1; i >= 0; i--) {
        const ev = sessionEvents[i]
        if (ev && ev.type === 'assistant/message' && ev.data) {
          const content =
            typeof ev.data === 'string'
              ? ev.data
              : (ev.data as { content?: string }).content
          if (typeof content === 'string') {
            const isCss = clean.endsWith('.css')
            const isJs = clean.endsWith('.js')
            const langToken = isCss ? 'css' : isJs ? '(?:js|javascript)' : ''
            if (langToken) {
              const fenceRe = new RegExp('```' + langToken + '\\b([\\s\\S]*?)```', 'gi')
              let fm: RegExpExecArray | null
              while ((fm = fenceRe.exec(content)) !== null) {
                const code = fm[1].trim()
                if (code.length > 5) return code
              }
            }
          }
        }
      }
    }

    return null
  }

  // 1. Inlining <link rel="stylesheet" href="...">
  const cssLinkRe = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>|<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi
  const cssMatches: Array<{ tag: string; href: string }> = []
  let m: RegExpExecArray | null
  while ((m = cssLinkRe.exec(bundled)) !== null) {
    const href = m[1] || m[2]
    if (href && !/^https?:\/\/|^\/\//i.test(href)) {
      cssMatches.push({ tag: m[0], href })
    }
  }

  for (const match of cssMatches) {
    const cssContent = await readFile(match.href)
    if (cssContent) {
      bundled = bundled.replace(
        match.tag,
        `<style>/* inlined ${match.href} */\n${cssContent}\n</style>`
      )
    }
  }

  // 2. Inlining <script src="..."></script>
  const jsScriptRe = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi
  const jsMatches: Array<{ tag: string; src: string }> = []
  while ((m = jsScriptRe.exec(bundled)) !== null) {
    const src = m[1]
    if (src && !/^https?:\/\/|^\/\//i.test(src)) {
      jsMatches.push({ tag: m[0], src })
    }
  }

  for (const match of jsMatches) {
    let jsContent = await readFile(match.src)
    if (jsContent) {
      // Check if the script contains CDN script tags inside an innerHTML string
      // (common small LLM anti-pattern: innerHTML = '<script src="...three...">')
      const innerScriptRe = /<script\s+src=["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/script>/gi
      let sMatch: RegExpExecArray | null
      const cdnUrls: string[] = []
      while ((sMatch = innerScriptRe.exec(jsContent)) !== null) {
        cdnUrls.push(sMatch[1])
      }
      if (cdnUrls.length > 0) {
        const uniqueCdns = Array.from(new Set(cdnUrls))
        const cdnTags = uniqueCdns.map((u) => `<script src="${u}"></script>`).join('\n')
        if (bundled.includes('</head>')) {
          bundled = bundled.replace('</head>', `${cdnTags}\n</head>`)
        } else {
          bundled = `${cdnTags}\n${bundled}`
        }
      }

      bundled = bundled.replace(
        match.tag,
        `<script>/* inlined ${match.src} */\n${jsContent}\n</script>`
      )
    }
  }

  return bundled
}
