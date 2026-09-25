/**
 * previewBundler.ts — Resolves, transforms, and inlines assets
 * into self-contained HTML for reliable artifact preview in sandboxed iframes.
 *
 * Supports:
 *  - Single-file React (JSX/TSX) apps with Tailwind CSS, Lucide icons, and Babel in-browser compiling
 *  - Mermaid architecture and sequence diagrams
 *  - Standalone HTML with automatic Tailwind CSS CDN injection
 *  - Resolving local workspace assets (CSS, JS)
 */

export function isReactArtifact(code: string, lang?: string): boolean {
  if (!code || typeof code !== 'string') return false
  const l = (lang || '').toLowerCase()
  if (l === 'tsx' || l === 'jsx' || l === 'react') return true
  // Check for React component patterns
  if (
    (/import\s+.*?from\s+['"]react['"]/i.test(code) ||
      /from\s+['"]lucide-react['"]/i.test(code) ||
      /export\s+default\s+function/i.test(code) ||
      /function\s+[A-Z]\w*\s*\([^)]*\)\s*\{[\s\S]*return\s*\(?/i.test(code) ||
      /const\s+[A-Z]\w*\s*=\s*(?:\([^)]*\)|props)\s*=>\s*\{?[\s\S]*return/i.test(code) ||
      /<[A-Z]\w*[\s\S]*\/>/i.test(code) ||
      /(?:useState|useEffect|useRef|useMemo)\s*\(/i.test(code)) &&
    !/<!doctype\s+html/i.test(code) &&
    !/<html[\s>]/i.test(code)
  ) {
    return true
  }
  return false
}

export function isMermaidArtifact(code: string, lang?: string): boolean {
  if (!code || typeof code !== 'string') return false
  const l = (lang || '').toLowerCase()
  if (l === 'mermaid') return true
  const trimmed = code.trim()
  return /^(?:flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|graph\s+[TBRLE])/im.test(
    trimmed
  )
}

export function extractLocalhostUrl(code: string): string | null {
  if (!code || typeof code !== 'string') return null
  const trimmed = code.trim()
  const match = trimmed.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)(?:\/[^\s"']*)?/i)
  if (match) {
    const raw = match[0].replace(/[)\]>.,;'"]+$/, '').replace(/\/+$/, '')
    return raw.replace('0.0.0.0', 'localhost')
  }
  return null
}

export function isLocalhostArtifact(code: string, lang?: string): boolean {
  if (!code || typeof code !== 'string') return false
  const l = (lang || '').toLowerCase()
  if (l === 'url' || l === 'server' || l === 'port' || l === 'devserver') return true
  const trimmed = code.trim()
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/i.test(trimmed)
}

export function bundleLocalhostPreview(url: string): string {
  const cleanUrl = url.trim().replace(/^['"]|['"]$/g, '')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f8fafc; color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    }
    .server-bar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px; background: #ffffff; border-bottom: 1px solid #e2e8f0;
      font-size: 12px; z-index: 10;
    }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #10b981; box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .badge {
      font-weight: 700; color: #10b981; font-size: 11px;
      letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap;
    }
    .url-input {
      flex: 1; background: #ffffff; border: 1px solid #cbd5e1;
      border-radius: 6px; padding: 5px 10px; color: #38bdf8;
      font-family: monospace; font-size: 12px; outline: none;
    }
    .btn {
      background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;
      padding: 5px 12px; color: #334155; font-size: 11px; font-weight: 600;
      cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
      transition: all 0.2s; white-space: nowrap;
    }
    .btn:hover { background: #f1f5f9; border-color: #94a3b8; }
    .btn-primary { background: #0284c7; border-color: #38bdf8; color: #ffffff; }
    .btn-primary:hover { background: #0369a1; }
    .frame-container { flex: 1; position: relative; background: #f8fafc; }
    iframe { width: 100%; height: 100%; border: none; background: #ffffff; }
  </style>
</head>
<body>
  <div class="server-bar">
    <div class="status-dot"></div>
    <span class="badge">Live App</span>
    <input type="text" class="url-input" id="urlInput" value="${cleanUrl}" readonly />
    <button class="btn" onclick="refreshFrame()" title="Reload Server Preview">↻ Refresh</button>
    <button class="btn btn-primary" onclick="openExternal()" title="Open in External Browser">↗ Open in Browser</button>
  </div>
  <div class="frame-container">
    <iframe id="previewFrame" src="${cleanUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>
  </div>
  <script>
    function refreshFrame() {
      const f = document.getElementById('previewFrame');
      if (f) {
        f.src = "${cleanUrl}?_t=" + Date.now();
      }
    }
    function openExternal() {
      window.open("${cleanUrl}", "_blank");
    }
  </script>
</body>
</html>`
}

export function isBinaryArtifact(code: string, lang?: string): boolean {
  const l = (lang || '').toLowerCase()
  return l === 'pptx' || l === 'xlsx' || l === 'docx' || l === 'pdf' || l === 'ppt' || l === 'xls' || l === 'doc'
}

export function isVisualArtifact(code: string, lang?: string): boolean {
  if (!code || typeof code !== 'string') return false
  const l = (lang || '').toLowerCase()
  if (isBinaryArtifact(code, lang)) return false
  if (l === 'html' || l === 'svg' || l === 'tsx' || l === 'jsx' || l === 'react' || l === 'mermaid' || l === 'url' || l === 'server' || l === 'devserver') return true
  if (code.includes('<svg') && code.includes('</svg>')) return true
  if (isLocalhostArtifact(code, lang) || !!extractLocalhostUrl(code)) return true
  if (isReactArtifact(code, lang)) return true
  if (isMermaidArtifact(code, lang)) return true
  if (code.includes('<!DOCTYPE') || code.includes('<html') || (code.includes('<div') && code.includes('</div>'))) return true
  return false
}

export function bundleBinaryPreview(fileName: string, lang: string): string {
  const ext = (lang || fileName.split('.').pop() || '').toUpperCase()
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>body{margin:0;padding:32px;background:#f8fafc;color:#0f172a;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;} .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08);} .icon{width:56px;height:56px;margin:0 auto 16px;background:#0f172a;color:#fff;border-radius:14px;display:flex;align-items:center;justify-content:center;font:700 20px/1 Inter;} .title{font:700 16px/1.3 Inter;margin:0 0 6px;} .sub{font:400 13px/1.5 Inter;color:#64748b;margin:0 0 18px;} .btn{appearance:none;border:none;background:#0f172a;color:#fff;padding:10px 18px;border-radius:10px;font:600 13px/1 Inter;cursor:pointer;}</style></head><body><div class="card"><div class="icon">${ext.slice(0,2)}</div><div class="title">${fileName}</div><div class="sub">Binary ${ext} file — generated in workspace. Open it via the Download/Open button in the chat file list or the system file manager.</div><button class="btn" onclick="alert('Use Open Folder in chat to locate '+fileName)">Locate file →</button></div></body></html>`
}

export function bundleReactPreview(code: string): string {
  // Strip import statements
  let clean = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
  clean = clean.replace(/import\s+['"][^'"]+['"];?/g, '')

  // Identify root component name
  let componentName = 'App'
  const defaultFuncMatch = clean.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/)
  const defaultVarMatch = clean.match(/export\s+default\s+([A-Za-z0-9_]+)/)
  const anyFuncMatch = clean.match(/function\s+([A-Z][A-Za-z0-9_]*)/)
  const anyConstMatch = clean.match(/(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/)

  if (defaultFuncMatch) {
    componentName = defaultFuncMatch[1]
  } else if (defaultVarMatch) {
    componentName = defaultVarMatch[1]
  } else if (anyFuncMatch) {
    componentName = anyFuncMatch[1]
  } else if (anyConstMatch) {
    componentName = anyConstMatch[1]
  }

  // Remove exports so variables are in local scope
  clean = clean.replace(/export\s+default\s+function\s+/g, 'function ')
  clean = clean.replace(/export\s+default\s+[A-Za-z0-9_]+;?/g, '')
  clean = clean.replace(/export\s+(?:function|const|let|var|class)\s+/g, (m) => m.replace('export ', ''))

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'rgba(15, 23, 42, 0.12)',
            background: '#f8fafc',
            foreground: '#0f172a',
          }
        }
      }
    };
  </script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      overflow-x: hidden;
    }
    #error-container {
      display: none;
      margin: 20px;
      padding: 16px;
      background: #450a0a;
      border: 1px solid #dc2626;
      border-radius: 8px;
      color: #fecaca;
      font-family: monospace;
      font-size: 13px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-900 antialiased min-h-screen">
  <div id="error-container"></div>
  <div id="root"></div>

  <script type="text/babel" data-presets="react,typescript">
    window.onerror = function(msg, url, line, col, error) {
      const errBox = document.getElementById('error-container');
      if (errBox) {
        errBox.style.display = 'block';
        errBox.textContent = 'Runtime error: ' + (error ? error.stack || error.message : msg);
      }
    };

    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext } = React;

    // Mock/Proxy for Lucide Icons
    const LucideFallback = new Proxy({}, {
      get: (target, prop) => {
        if (typeof prop === 'string' && prop !== 'then' && prop !== '$$typeof') {
          return function LucideIcon(iconProps) {
            const size = iconProps.size || 20;
            const className = iconProps.className || '';
            const color = iconProps.color || 'currentColor';
            return (
              <span
                className={'inline-flex items-center justify-center ' + className}
                style={{ width: size, height: size, verticalAlign: 'middle', display: 'inline-flex' }}
                title={prop}
              >
                <i data-lucide={prop.toLowerCase()} style={{ width: size, height: size, stroke: color }}></i>
              </span>
            );
          };
        }
        return undefined;
      }
    });

    // Provide all common icons from Proxy
    const {
      DollarSign, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownLeft, ArrowRight, ArrowLeft,
      Wallet, CreditCard, Shield, User, Lock, Key, Check, X, RefreshCw, Trophy, Zap,
      AlertCircle, Play, Pause, RotateCcw, Clock, Calendar, CheckCircle2, ChevronRight,
      ChevronLeft, MoreVertical, Plus, Minus, Search, Settings, HelpCircle, Eye, EyeOff
    } = LucideFallback;

    // Safe fallbacks for common creative canvas/styling undeclared globals
    if (typeof window.color === 'undefined') window.color = '#38bdf8';
    if (typeof window.colors === 'undefined') window.colors = ['#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#34d399', '#fbbf24'];
    if (typeof window.theme === 'undefined') window.theme = 'light';

    try {
      ${clean}

      const TargetApp = typeof ${componentName} !== 'undefined'
        ? ${componentName}
        : (typeof App !== 'undefined' ? App : null);

      if (TargetApp) {
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<TargetApp />);
      } else {
        const errBox = document.getElementById('error-container');
        if (errBox) {
          errBox.style.display = 'block';
          errBox.textContent = 'Could not find a valid React component to mount. Ensure your component is exported or named ${componentName}.';
        }
      }
    } catch (err) {
      const errBox = document.getElementById('error-container');
      if (errBox) {
        errBox.style.display = 'block';
        errBox.textContent = 'Render compilation error: ' + (err.stack || err.message);
      }
    }
  </script>
  <script>
    setTimeout(function() {
      if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
      }
    }, 400);
  </script>
</body>
</html>`
}

export function bundleMermaidPreview(code: string): string {
  const cleanCode = code
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 32px 24px;
      background: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: auto;
    }
    .mermaid-container {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 36px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      max-width: 95%;
      display: flex;
      justify-content: center;
    }
    #error-box {
      display: none;
      margin-bottom: 20px;
      padding: 16px;
      background: #450a0a;
      border: 1px solid #dc2626;
      border-radius: 8px;
      color: #fecaca;
      font-family: monospace;
      font-size: 13px;
      max-width: 90%;
    }
  </style>
</head>
<body>
  <div id="error-box"></div>
  <div class="mermaid-container">
    <pre class="mermaid">
${cleanCode}
    </pre>
  </div>
  <script>
    try {
      mermaid.initialize({
        startOnLoad: true,
        theme: 'light',
        themeVariables: {
          darkMode: false,
          background: '#0f172a',
          primaryColor: '#2563eb',
          primaryTextColor: '#0f172a',
          primaryBorderColor: '#3b82f6',
          lineColor: '#38bdf8',
          secondaryColor: '#7c3aed',
          tertiaryColor: '#059669',
          actorBkg: '#f8fafc',
          actorBorder: '#3b82f6',
          actorTextColor: '#0f172a',
          signalColor: '#38bdf8',
          signalTextColor: '#0f172a',
          labelBoxBkgColor: '#f8fafc',
          labelBoxBorderColor: '#38bdf8',
          labelTextColor: '#0f172a',
          loopTextColor: '#0f172a',
          noteBkgColor: '#f8fafc',
          noteBorderColor: '#64748b',
          noteTextColor: '#0f172a'
        },
        flowchart: { curve: 'basis', htmlLabels: true },
        sequence: { showSequenceNumbers: true, actorMargin: 50 }
      });
    } catch (e) {
      const errEl = document.getElementById('error-box');
      if (errEl) {
        errEl.style.display = 'block';
        errEl.textContent = 'Mermaid syntax error: ' + (e.message || String(e));
      }
    }
  </script>
</body>
</html>`
}

export async function preparePreviewHtml(
  html: string,
  sessionEvents?: Array<{ type: string; data: unknown }>,
  sessionId?: string,
  language?: string
): Promise<string> {
  if (!html || typeof html !== 'string') return ''

  // Binary files never preview as visual HTML — return dedicated download card
  if (isBinaryArtifact(html, language) && html.length < 800) {
    // html param is actually file path / short name for binary placeholder
    return bundleBinaryPreview(html, language || 'pptx')
  }

  // 0. Live Local Dev Server URL / Port preview
  if (isLocalhostArtifact(html, language) || (extractLocalhostUrl(html) && !html.includes('<html') && !isReactArtifact(html, language))) {
    const url = extractLocalhostUrl(html) || html.trim()
    return bundleLocalhostPreview(url)
  }

  // 1. Mermaid preview
  if (isMermaidArtifact(html, language)) {
    return bundleMermaidPreview(html)
  }

  // 2. React / JSX / TSX preview
  if (isReactArtifact(html, language)) {
    return bundleReactPreview(html)
  }

  // 3. SVG preview
  if ((language === 'svg' || html.trim().startsWith('<svg')) && html.includes('</svg>')) {
    return `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f8fafc;padding:24px;}svg{max-width:100%;max-height:100%;width:auto;height:auto;filter:drop-shadow(0 10px 15px rgba(0,0,0,0.4));}</style></head><body>${html}</body></html>`
  }

  let bundled = html

  // Auto-inject Tailwind CSS CDN if HTML contains Tailwind classes but lacks Tailwind script
  const hasTailwindClasses = /\b(bg-|text-|p-|m-|flex|grid|rounded|shadow|border-)\b/.test(bundled)
  const hasTailwindScript = /tailwindcss|tailwind\.css/i.test(bundled)
  if (hasTailwindClasses && !hasTailwindScript) {
    const tailwindCdn = `<script src="https://cdn.tailwindcss.com"></script>\n<script>tailwind.config={darkMode:'class'}</script>`
    if (bundled.includes('<head>')) {
      bundled = bundled.replace('<head>', `<head>\n  ${tailwindCdn}`)
    } else if (bundled.includes('<html>')) {
      bundled = bundled.replace('<html>', `<html><head>${tailwindCdn}</head>`)
    } else {
      bundled = `<!DOCTYPE html><html><head>${tailwindCdn}</head><body class="bg-slate-50 text-slate-900 p-4">${bundled}</body></html>`
    }
  }

  // Helper to read file content from workspace via IPC, or fallback to session events
  const readFile = async (relPath: string): Promise<string | null> => {
    const clean = relPath.replace(/^\.\//, '').trim()

    // 1. Try reading directly from workspace via tools:dispatch fs_read
    try {
      if (window.sovara?.invoke) {
        const resp = (await window.sovara.invoke('tools:dispatch', {
          name: 'fs_read',
          args: { path: clean, _forceApprove: true, ...(sessionId ? { sessionId } : {}) },
        })) as { ok?: boolean; result?: string | Record<string, unknown> }

        if (resp?.result) {
          const parsed = typeof resp.result === 'string' ? JSON.parse(resp.result) : resp.result
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
          const content = typeof ev.data === 'string' ? ev.data : (ev.data as { content?: string }).content
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

  // Inlining <link rel="stylesheet" href="...">
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
      bundled = bundled.replace(match.tag, `<style>/* inlined ${match.href} */\n${cssContent}\n</style>`)
    }
  }

  // Inlining <script src="..."></script>
  const jsScriptRe = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi
  const jsMatches: Array<{ tag: string; src: string }> = []
  while ((m = jsScriptRe.exec(bundled)) !== null) {
    const src = m[1]
    if (src && !/^https?:\/\/|^\/\//i.test(src)) {
      jsMatches.push({ tag: m[0], src })
    }
  }

  for (const match of jsMatches) {
    const jsContent = await readFile(match.src)
    if (jsContent) {
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

      bundled = bundled.replace(match.tag, `<script>/* inlined ${match.src} */\n${jsContent}\n</script>`)
    }
  }

  return bundled
}
