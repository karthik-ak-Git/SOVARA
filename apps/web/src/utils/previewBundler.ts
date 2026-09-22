/**
 * previewBundler.ts — Resolves and transforms assets for web artifact preview in sandboxed iframes.
 *
 * Supports:
 *  - Single-file React (JSX/TSX) apps with Tailwind CSS, Lucide icons, and Babel in-browser compiling
 *  - Mermaid architecture and sequence diagrams
 *  - Standalone HTML with automatic Tailwind CSS CDN injection
 */

export function isReactArtifact(code: string, lang?: string): boolean {
  if (!code || typeof code !== 'string') return false
  const l = (lang || '').toLowerCase()
  if (l === 'tsx' || l === 'jsx' || l === 'react') return true
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
      background: #090d16; color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    }
    .server-bar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px; background: #0f172a; border-bottom: 1px solid #1e293b;
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
      flex: 1; background: #1e293b; border: 1px solid #334155;
      border-radius: 6px; padding: 5px 10px; color: #38bdf8;
      font-family: monospace; font-size: 12px; outline: none;
    }
    .btn {
      background: #1e293b; border: 1px solid #334155; border-radius: 6px;
      padding: 5px 12px; color: #f8fafc; font-size: 11px; font-weight: 600;
      cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
      transition: all 0.2s; white-space: nowrap;
    }
    .btn:hover { background: #334155; border-color: #475569; }
    .btn-primary { background: #0284c7; border-color: #38bdf8; color: #ffffff; }
    .btn-primary:hover { background: #0369a1; }
    .frame-container { flex: 1; position: relative; background: #090d16; }
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

export function isVisualArtifact(code: string, lang?: string): boolean {
  if (!code || typeof code !== 'string') return false
  const l = (lang || '').toLowerCase()
  if (l === 'html' || l === 'svg' || l === 'tsx' || l === 'jsx' || l === 'react' || l === 'mermaid' || l === 'url' || l === 'server' || l === 'devserver') return true
  if (code.includes('<svg') && code.includes('</svg>')) return true
  if (isLocalhostArtifact(code, lang) || !!extractLocalhostUrl(code)) return true
  if (isReactArtifact(code, lang)) return true
  if (isMermaidArtifact(code, lang)) return true
  if (code.includes('<!DOCTYPE') || code.includes('<html') || (code.includes('<div') && code.includes('</div>'))) return true
  return false
}

export function bundleReactPreview(code: string): string {
  let clean = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
  clean = clean.replace(/import\s+['"][^'"]+['"];?/g, '')

  let componentName = 'App'
  const defaultFuncMatch = clean.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/)
  const defaultVarMatch = clean.match(/export\s+default\s+([A-Za-z0-9_]+)/)
  const anyFuncMatch = clean.match(/function\s+([A-Z][A-Za-z0-9_]*)/)
  const anyConstMatch = clean.match(/(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/)

  if (defaultFuncMatch) componentName = defaultFuncMatch[1]
  else if (defaultVarMatch) componentName = defaultVarMatch[1]
  else if (anyFuncMatch) componentName = anyFuncMatch[1]
  else if (anyConstMatch) componentName = anyConstMatch[1]

  clean = clean.replace(/export\s+default\s+function\s+/g, 'function ')
  clean = clean.replace(/export\s+default\s+[A-Za-z0-9_]+;?/g, '')
  clean = clean.replace(/export\s+(?:function|const|let|var|class)\s+/g, (m) => m.replace('export ', ''))

  return `<!DOCTYPE html>
<html lang="en" class="dark">
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
            border: 'rgba(255, 255, 255, 0.1)',
            background: '#090d16',
            foreground: '#f8fafc',
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
      margin: 0; padding: 0; min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #090d16; color: #f8fafc; overflow-x: hidden;
    }
    #error-container {
      display: none; margin: 20px; padding: 16px;
      background: #450a0a; border: 1px solid #dc2626; border-radius: 8px;
      color: #fecaca; font-family: monospace; font-size: 13px; white-space: pre-wrap;
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 antialiased dark min-h-screen">
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

    const {
      DollarSign, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownLeft, ArrowRight, ArrowLeft,
      Wallet, CreditCard, Shield, User, Lock, Key, Check, X, RefreshCw, Trophy, Zap,
      AlertCircle, Play, Pause, RotateCcw, Clock, Calendar, CheckCircle2, ChevronRight,
      ChevronLeft, MoreVertical, Plus, Minus, Search, Settings, HelpCircle, Eye, EyeOff
    } = LucideFallback;

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
      margin: 0; padding: 32px 24px;
      background: #090d16; color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh; overflow: auto;
    }
    .mermaid-container {
      background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 36px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); max-width: 95%; display: flex; justify-content: center;
    }
    #error-box {
      display: none; margin-bottom: 20px; padding: 16px;
      background: #450a0a; border: 1px solid #dc2626; border-radius: 8px;
      color: #fecaca; font-family: monospace; font-size: 13px; max-width: 90%;
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
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#0f172a',
          primaryColor: '#2563eb',
          primaryTextColor: '#f8fafc',
          primaryBorderColor: '#3b82f6',
          lineColor: '#38bdf8',
          secondaryColor: '#7c3aed',
          tertiaryColor: '#059669',
          actorBkg: '#1e293b',
          actorBorder: '#3b82f6',
          actorTextColor: '#f8fafc',
          signalColor: '#38bdf8',
          signalTextColor: '#f8fafc',
          labelBoxBkgColor: '#1e293b',
          labelBoxBorderColor: '#38bdf8',
          labelTextColor: '#f8fafc',
          loopTextColor: '#f8fafc',
          noteBkgColor: '#1e293b',
          noteBorderColor: '#64748b',
          noteTextColor: '#f8fafc'
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
  _sessionEvents?: unknown,
  _sessionId?: string,
  language?: string
): Promise<string> {
  if (!html || typeof html !== 'string') return ''

  if (isLocalhostArtifact(html, language) || (extractLocalhostUrl(html) && !html.includes('<html') && !isReactArtifact(html, language))) {
    const url = extractLocalhostUrl(html) || html.trim()
    return bundleLocalhostPreview(url)
  }

  if (isMermaidArtifact(html, language)) {
    return bundleMermaidPreview(html)
  }

  if (isReactArtifact(html, language)) {
    return bundleReactPreview(html)
  }

  if ((language === 'svg' || html.trim().startsWith('<svg')) && html.includes('</svg>')) {
    return `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#090d16;padding:24px;}svg{max-width:100%;max-height:100%;width:auto;height:auto;filter:drop-shadow(0 10px 15px rgba(0,0,0,0.4));}</style></head><body>${html}</body></html>`
  }

  let bundled = html
  const hasTailwindClasses = /\b(bg-|text-|p-|m-|flex|grid|rounded|shadow|border-)\b/.test(bundled)
  const hasTailwindScript = /tailwindcss|tailwind\.css/i.test(bundled)
  if (hasTailwindClasses && !hasTailwindScript) {
    const tailwindCdn = `<script src="https://cdn.tailwindcss.com"></script>\n<script>tailwind.config={darkMode:'class'}</script>`
    if (bundled.includes('<head>')) {
      bundled = bundled.replace('<head>', `<head>\n  ${tailwindCdn}`)
    } else if (bundled.includes('<html>')) {
      bundled = bundled.replace('<html>', `<html><head>${tailwindCdn}</head>`)
    } else {
      bundled = `<!DOCTYPE html><html class="dark"><head>${tailwindCdn}</head><body class="bg-slate-950 text-slate-100 dark p-4">${bundled}</body></html>`
    }
  }

  return bundled
}
