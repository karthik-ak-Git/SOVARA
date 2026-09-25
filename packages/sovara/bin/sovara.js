#!/usr/bin/env node
'use strict';
// Sovara CLI — opencode-style agent commands + Sovara hardware monitor.
// Zero dependencies, Node >= 22. Local-first: Ollama :11434, LM Studio :1234,
// or Sovara llama server ($SOVARA_SERVER_URL).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const { getHardwareProfile, getCompatibilityMessage } = require('../lib/hardware');
const { estimateFit, DEFAULT_N_CTX } = require('../lib/fit');
const { detectRuntimes } = require('../lib/runtimes');
const { chatCompletion, resolveEndpoint } = require('../lib/chat');
const { newSessionId, appendMessage, readSession, lastSessionId, listSessions } = require('../lib/store');
const { runWithTools } = require('../lib/tools');

const VERSION = require('../package.json').version;

function help() {
  console.log(`sovara v${VERSION} — local-first AI coding agent

Usage: sovara <command> [options]

Commands (opencode-style + Sovara hardware):
  install                 Download + launch the Windows desktop installer
  hardware [--json] [--watch] [--interval 2]
                          GPU / RAM / VRAM / storage monitor (watch = live view)
  models [--json]         List local models (Sovara library + Ollama + LM Studio)
  fit --size-gb N [--params 7B] [--ctx 4096] [--json]
                          Will this GGUF fit? (isolated VRAM/RAM pools, never summed)
  run "prompt" [-m model] [--dir .] [--agent plan|build] [--yolo]
      [--format text|json] [-c|--continue] [-s session] [--base-url URL] [--title T]
                          Single-shot agent run against a local endpoint
  chat [-m model] [--dir .] [--agent plan|build] [--yolo] [-s session] [-c]
                          Interactive prompt loop (type /help, /exit)
  serve [--port 4096] [--hostname 127.0.0.1] [--open]
                          Local server + dashboard (/, /health, /v1/models, /status)
  status [--json]         Hardware + runtimes + library summary
  doctor [--json]         Preflight checks (hardware, runtimes, library)
  sessions                List recent CLI sessions

Bare 'sovara' shows the status screen. Flags follow opencode run
conventions: -m/--model, --dir, --format json, -c/--continue, -s/--session.
--agent plan is read-only (default); --agent build + --yolo allows shell_exec.
`);
}

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out.flags[a.slice(2, eq)] = a.slice(eq + 1); i++; continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) { out.flags[key] = next; i += 2; }
      else { out.flags[key] = true; i++; }
      continue;
    }
    if (a.startsWith('-') && a.length === 2) {
      const key = a[1];
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) { out.flags[key] = next; i += 2; }
      else { out.flags[key] = true; i++; }
      continue;
    }
    out._.push(a);
    i++;
  }
  return out;
}

function emit(obj, asJson) {
  if (asJson) console.log(JSON.stringify(obj, null, 2));
  else console.log(obj);
}

async function readPipedStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data.trim()));
    setTimeout(() => resolve(data.trim()), 500);
  });
}

function hardwareLines(hw) {
  const lines = [];
  lines.push('— Sovara hardware —');
  lines.push(`OS:      ${hw.os} ${hw.osVersion} (${hw.arch})`);
  lines.push(`CPU:     ${hw.cpuModel} (${hw.cpuThreads} threads)`);
  lines.push(`RAM:     ${bar(hw.totalRamMB - hw.freeRamMB, hw.totalRamMB)} ${(hw.freeRamMB / 1024).toFixed(1)} free / ${(hw.totalRamMB / 1024).toFixed(1)} GB total`);
  if (hw.gpuDetected) {
    lines.push(`GPU:     ${hw.gpuName} [${hw.gpuVendor}] runtime=${hw.gpuRuntime}`);
    const used = hw.freeVramMB !== undefined ? hw.totalVramMB - hw.freeVramMB : 0;
    lines.push(`VRAM:    ${bar(used, hw.totalVramMB)} ${hw.freeVramMB !== undefined ? `${(hw.freeVramMB / 1024).toFixed(1)} free / ` : ''}${(hw.totalVramMB / 1024).toFixed(1)} GB total${hw.gpuUtilization !== undefined ? ` (${hw.gpuUtilization}% load)` : ''}`);
  } else {
    lines.push('GPU:     none detected (CPU mode)');
  }
  if (hw.storageFreeGB !== undefined) lines.push(`Disk:    ${hw.storageFreeGB} free / ${hw.storageTotalGB} GB total`);
  lines.push(getCompatibilityMessage(hw));
  return lines;
}

function bar(used, total, width = 16) {
  if (!(total > 0)) return '';
  const fill = Math.max(0, Math.min(width, Math.round((used / total) * width)));
  return `[${'#'.repeat(fill)}${'-'.repeat(width - fill)}]`;
}

async function cmdHardware(flags) {
  const asJson = Boolean(flags.json);
  const watch = Boolean(flags.watch);
  if (asJson) {
    const hw = getHardwareProfile();
    return emit({ ...hw, summary: getCompatibilityMessage(hw) }, true);
  }
  if (!watch) {
    for (const l of hardwareLines(getHardwareProfile())) console.log(l);
    return;
  }
  const interval = Math.max(1, parseInt(flags.interval || '2', 10) || 2);
  console.log(`Live hardware (every ${interval}s — Ctrl+C to exit)\n`);
  const tick = () => {
    console.clear();
    console.log(`Live hardware (every ${interval}s — Ctrl+C to exit)\n`);
    for (const l of hardwareLines(getHardwareProfile())) console.log(l);
  };
  tick();
  await new Promise((resolve) => {
    const t = setInterval(tick, interval * 1000);
    const stop = () => { clearInterval(t); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function cmdModels(flags) {
  const rt = await detectRuntimes(process.env.SOVARA_SERVER_URL);
  const asJson = Boolean(flags.json);
  if (asJson) return emit(rt, true);
  console.log('— Sovara library —');
  if (rt.library.roots.length === 0) console.log('(no library dir found; set SOVARA_MODELS_DIR)');
  else {
    console.log(`roots: ${rt.library.roots.join(', ')}`);
    for (const f of rt.library.files.slice(0, 30)) console.log(`  ${f.sizeGB.toFixed(2)} GB  ${f.path}`);
    if (rt.library.files.length > 30) console.log(`  … +${rt.library.files.length - 30} more`);
  }
  console.log(`— Ollama ${rt.ollama.online ? 'online' : 'offline'} (${rt.ollama.models.length}) —`);
  for (const m of rt.ollama.models) console.log(`  ${m.name}${m.isVramActive ? '  [active]' : ''}`);
  console.log(`— LM Studio ${rt.lmstudio.online ? 'online' : 'offline'} (${rt.lmstudio.models.length}) —`);
  for (const m of rt.lmstudio.models) console.log(`  ${m.name}`);
  if (rt.sovara.online) {
    console.log(`— Sovara server online (${rt.sovara.models.length}) —`);
    for (const m of rt.sovara.models) console.log(`  ${m.name}`);
  }
  console.log(`total local models: ${rt.totalLocalModels}`);
}

async function cmdFit(flags) {
  const sizeGB = parseFloat(flags['size-gb'] ?? flags.size ?? '');
  const params = flags.params || '7B';
  const nCtx = parseInt(flags.ctx || flags['n-ctx'] || DEFAULT_N_CTX, 10);
  if (!(sizeGB > 0)) {
    console.error('Usage: sovara fit --size-gb <GGUF_GB> [--params 7B] [--ctx 4096] [--json]');
    process.exitCode = 2;
    return;
  }
  const hw = getHardwareProfile();
  const fit = estimateFit({ sizeGB, params, nCtx, hw });
  const asJson = Boolean(flags.json);
  if (asJson) return emit({ sizeGB, params, nCtx, hardware: hw, fit }, true);
  console.log(`need ~${fit.needGB.toFixed(1)} GB (weights ${(sizeGB * 1.12).toFixed(1)} + KV ${fit.kvGB.toFixed(1)} @${nCtx}) → ${fit.severity}`);
  console.log(fit.message);
}

async function cmdRun(positional, flags) {
  const piped = await readPipedStdin();
  let prompt = positional.join(' ').trim();
  if (piped) prompt = prompt ? `${prompt}\n${piped}` : piped;
  const fileFlag = flags.f || flags.file;
  if (fileFlag) {
    try {
      const extra = fs.readFileSync(String(fileFlag), 'utf8');
      prompt = prompt ? `${prompt}\n${extra}` : extra;
    } catch (e) { console.error(`--file: ${e.message}`); process.exitCode = 2; return; }
  }
  if (!prompt) { console.error('Usage: sovara run "prompt" [-m model] [--dir .] [--agent plan|build] [--yolo]'); process.exitCode = 2; return; }

  const model = flags.m || flags.model;
  const dir = path.resolve(String(flags.dir || flags.d || '.'));
  const agent = String(flags.agent || 'plan');
  if (agent !== 'plan' && agent !== 'build') { console.error('--agent must be plan|build'); process.exitCode = 2; return; }
  const yolo = Boolean(flags.yolo);
  const format = String(flags.format || 'text');
  const baseUrlFlag = flags['base-url'];

  let sessionId = flags.s || flags.session;
  if ((flags.c || flags.continue) && !sessionId) sessionId = lastSessionId();
  if (!sessionId) sessionId = newSessionId();
  const history = readSession(sessionId) || [];

  const runtimes = await detectRuntimes(process.env.SOVARA_SERVER_URL);
  const { baseUrl, model: resolvedModel } = resolveEndpoint({ baseUrl: baseUrlFlag, model, runtimes });
  if (!resolvedModel || resolvedModel === 'default') {
    console.error('No local model found. Start Ollama (:11434), LM Studio (:1234), or set SOVARA_SERVER_URL + -m.');
    console.error('See: sovara models / sovara doctor');
    process.exitCode = 1;
    return;
  }

  const system = agent === 'plan'
    ? 'You are Sovara, a local-first coding assistant. Read-only mode: do not invent file writes; cite paths. You may emit ```tool:read path="..."``` or ```tool:glob pattern="..."``` fences (resolved against --dir).'
    : 'You are Sovara, a local-first coding assistant with shell access when approved. You may emit ```tool:read```, ```tool:glob```, or ```tool:shell command="..."``` fences (shell runs only with --yolo).';
  const messages = [
    { role: 'system', content: system },
    ...history.filter((m) => m.role !== 'system'),
    { role: 'user', content: prompt },
  ];
  const chat = ({ baseUrl: b, model: m, messages: ms }) => chatCompletion({ baseUrl: b, model: m, messages: ms });
  const started = Date.now();
  const { content } = await runWithTools({
    chat, baseUrl, model: resolvedModel, dir, agent, yolo, messages,
    onTool: (t) => { if (format === 'text') console.error(`[tool:${t.kind}] ${t.ok ? 'ok' : `failed: ${t.error}`}`); },
  });

  appendMessage(sessionId, { role: 'user', content: prompt });
  appendMessage(sessionId, { role: 'assistant', content, model: `${baseUrl} :: ${resolvedModel}` });

  if (format === 'json') {
    emit({ sessionId, model: resolvedModel, baseUrl, agent, dir, ms: Date.now() - started, output: content }, true);
  } else {
    console.log(content);
    console.error(`\n(session ${sessionId} · ${resolvedModel} · ${Date.now() - started}ms)`);
  }
}

async function cmdChat(flags) {
  let model = flags.m || flags.model;
  let dir = path.resolve(String(flags.dir || flags.d || '.'));
  let agent = String(flags.agent || 'plan');
  let yolo = Boolean(flags.yolo);
  const baseUrlFlag = flags['base-url'];
  let sessionId = flags.s || flags.session;
  if ((flags.c || flags.continue) && !sessionId) sessionId = lastSessionId();
  if (!sessionId) sessionId = newSessionId();

  console.log(`sovara chat  (session ${sessionId} · dir ${dir})`);
  console.log('Type /help for commands, /exit to quit.\n');

  const runtimes = await detectRuntimes(process.env.SOVARA_SERVER_URL);
  const showModels = () => {
    const names = [
      ...runtimes.ollama.models.map((m) => `ollama:${m.name}`),
      ...runtimes.lmstudio.models.map((m) => `lmstudio:${m.id || m.name}`),
    ];
    console.log(names.length > 0 ? `models: ${names.slice(0, 10).join(', ')}${names.length > 10 ? ' …' : ''}` : 'models: none online (start Ollama :11434 or LM Studio :1234)');
  };
  showModels();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'sovara> ' });
  const question = (q) => new Promise((resolve) => rl.question(q, resolve));
  const systemFor = (a) => a === 'plan'
    ? 'You are Sovara, a local-first coding assistant. Read-only mode: cite paths. You may emit ```tool:read path="..."``` or ```tool:glob pattern="..."``` fences (resolved against --dir).'
    : 'You are Sovara, a local-first coding assistant with shell access when approved. You may emit ```tool:read```, ```tool:glob```, or ```tool:shell command="..."``` fences (shell runs only with --yolo).';

  for (;;) {
    const line = (await question('sovara> ')).trim();
    if (!line) continue;
    if (line === '/exit' || line === '.exit' || line === '/quit' || line === 'exit()' || line === 'quit') break;
    if (line === '/help') {
      console.log('/help             this list\n/model <m>        switch model (ollama:.., lmstudio:.., sovara:..)\n/agent plan|build  switch agent\n/yolo              toggle shell approval for build agent\n/dir <path>        switch working dir\n/status            hardware + runtimes summary\n/models            list local models\n/clear             clear screen\n/exit              quit');
      continue;
    }
    if (line.startsWith('/model ')) { model = line.slice(7).trim() || model; console.log(`model: ${model || '(auto)'}`); continue; }
    if (line.startsWith('/agent ')) {
      const a = line.slice(7).trim();
      if (a !== 'plan' && a !== 'build') { console.log('--agent must be plan|build'); continue; }
      agent = a; console.log(`agent: ${agent}`); continue;
    }
    if (line === '/yolo') { yolo = !yolo; console.log(`yolo: ${yolo ? 'on' : 'off'}`); continue; }
    if (line.startsWith('/dir ')) {
      try { dir = path.resolve(line.slice(5).trim()); console.log(`dir: ${dir}`); }
      catch (e) { console.log(`bad dir: ${e.message}`); }
      continue;
    }
    if (line === '/status') { await cmdStatus({}); continue; }
    if (line === '/models') { await cmdModels({}); continue; }
    if (line === '/clear') { console.clear(); continue; }
    if (line.startsWith('/')) { console.log(`unknown: ${line} (try /help)`); continue; }

    try {
      const history = readSession(sessionId) || [];
      const { baseUrl, model: resolvedModel } = resolveEndpoint({ baseUrl: baseUrlFlag, model, runtimes });
      if (!resolvedModel || resolvedModel === 'default') {
        console.log('No local model online. Start Ollama (:11434) / LM Studio (:1234), or /model <name> with --base-url.');
        continue;
      }
      const messages = [
        { role: 'system', content: systemFor(agent) },
        ...history.filter((m) => m.role !== 'system'),
        { role: 'user', content: line },
      ];
      const chat = ({ baseUrl: b, model: m, messages: ms }) => chatCompletion({ baseUrl: b, model: m, messages: ms });
      const { content } = await runWithTools({
        chat, baseUrl, model: resolvedModel, dir, agent, yolo, messages,
        onTool: (t) => console.log(`[tool:${t.kind}] ${t.ok ? 'ok' : `failed: ${t.error}`}`),
      });
      appendMessage(sessionId, { role: 'user', content: line });
      appendMessage(sessionId, { role: 'assistant', content, model: `${baseUrl} :: ${resolvedModel}` });
      console.log(`\n${content}\n`);
    } catch (e) {
      console.log(`error: ${e?.message || e}`);
    }
  }
  rl.close();
  console.log(`\nbye (session ${sessionId})`);
}

function dashboardHtml(payload) {
  const rows = (payload.checks || []).map((c) => `<tr><td>${c.ok ? 'PASS' : '----'}</td><td>${c.name}</td><td>${c.detail}</td></tr>`).join('');
  const models = (payload.models || []).map((m) => `<li>${m.id} <small>(${m.owned_by})</small></li>`).join('') || '<li>(none online)</li>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sovara v${payload.version}</title><style>body{font-family:Consolas,monospace;max-width:760px;margin:32px auto;padding:0 16px}small{color:#666}table{border-collapse:collapse}td{border:1px solid #ddd;padding:4px 10px}</style></head><body><h1>sovara v${payload.version}</h1><p>${payload.summary}</p><h2>Models</h2><ul>${models}</ul><h2>Checks</h2><table>${rows}</table><p><a href="/status">/status (json)</a> · <a href="/v1/models">/v1/models</a> · <a href="/health">/health</a></p></body></html>`;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch { /* best-effort */ }
}

async function cmdServe(flags) {
  const port = parseInt(flags.port || flags.p || '4096', 10);
  const hostname = String(flags.hostname || '127.0.0.1');
  const server = http.createServer(async (req, res) => {
    try {
      const url = String(req.url || '/');
      if (url === '/' || url === '/dashboard') {
        const hw = getHardwareProfile();
        const rt = await detectRuntimes(process.env.SOVARA_SERVER_URL);
        const html = dashboardHtml({
          version: VERSION,
          summary: getCompatibilityMessage(hw),
          models: [
            ...rt.ollama.models.map((m) => ({ id: m.name, owned_by: 'ollama' })),
            ...rt.lmstudio.models.map((m) => ({ id: m.id || m.name, owned_by: 'lmstudio' })),
            ...rt.library.files.map((f) => ({ id: f.path, owned_by: 'sovara-library' })),
          ],
          checks: [
            { name: 'gpu', ok: true, detail: hw.gpuDetected ? `${hw.gpuName} (${hw.gpuRuntime})` : 'CPU mode' },
            { name: 'ollama', ok: rt.ollama.online, detail: rt.ollama.online ? `${rt.ollama.models.length} model(s)` : 'offline' },
            { name: 'lmstudio', ok: rt.lmstudio.online, detail: rt.lmstudio.online ? `${rt.lmstudio.models.length} model(s)` : 'offline' },
            { name: 'library', ok: rt.library.files.length > 0, detail: `${rt.library.files.length} GGUF(s)` },
          ],
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'sovara', version: VERSION }));
        return;
      }
      if (url === '/v1/models' || url === '/models') {
        const rt = await detectRuntimes(process.env.SOVARA_SERVER_URL);
        const data = [
          ...rt.ollama.models.map((m) => ({ id: m.name, owned_by: 'ollama' })),
          ...rt.lmstudio.models.map((m) => ({ id: m.id || m.name, owned_by: 'lmstudio' })),
          ...rt.library.files.map((f) => ({ id: f.path, owned_by: 'sovara-library' })),
        ];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
        return;
      }
      if (url === '/status') {
        const hw = getHardwareProfile();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hardware: hw, summary: getCompatibilityMessage(hw) }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'try /, /health, /v1/models, /status' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  server.listen(port, hostname, () => {
    const url = `http://${hostname}:${port}`;
    console.log(`sovara serve on ${url}  (/ /health /v1/models /status)`);
    if (flags.open) openBrowser(url);
  });
}

async function cmdStatus(flags) {
  const hw = getHardwareProfile();
  const rt = await detectRuntimes(process.env.SOVARA_SERVER_URL);
  const payload = {
    version: VERSION,
    hardware: hw,
    summary: getCompatibilityMessage(hw),
    ollama: { online: rt.ollama.online, models: rt.ollama.models.length },
    lmstudio: { online: rt.lmstudio.online, models: rt.lmstudio.models.length },
    sovaraServer: { online: rt.sovara.online, models: rt.sovara.models.length },
    library: { roots: rt.library.roots, files: rt.library.files.length },
    totalLocalModels: rt.totalLocalModels,
  };
  if (flags.json) return emit(payload, true);
  console.log(`sovara v${VERSION}`);
  console.log(getCompatibilityMessage(hw));
  console.log(`Ollama: ${payload.ollama.online ? `online (${payload.ollama.models} models)` : 'offline'} · LM Studio: ${payload.lmstudio.online ? `online (${payload.lmstudio.models} models)` : 'offline'} · Sovara server: ${payload.sovaraServer.online ? 'online' : 'offline'}`);
  console.log(`Library: ${payload.library.files} GGUF file(s)${payload.library.roots.length > 0 ? ` in ${payload.library.roots.join(', ')}` : ''}`);
}

async function cmdDoctor(flags) {
  const hw = getHardwareProfile();
  const rt = await detectRuntimes(process.env.SOVARA_SERVER_URL);
  const checks = [
    { name: 'os', ok: true, detail: `${hw.os} ${hw.arch}` },
    { name: 'node', ok: true, detail: process.version },
    { name: 'ram', ok: hw.totalRamMB >= 8 * 1024, detail: `${(hw.totalRamMB / 1024).toFixed(1)} GB total` },
    { name: 'gpu', ok: true, detail: hw.gpuDetected ? `${hw.gpuName} (${hw.gpuRuntime})` : 'no GPU — CPU mode' },
    { name: 'ollama', ok: rt.ollama.online, detail: rt.ollama.online ? `${rt.ollama.models.length} model(s)` : 'offline (:11434)' },
    { name: 'lmstudio', ok: rt.lmstudio.online, detail: rt.lmstudio.online ? `${rt.lmstudio.models.length} model(s)` : 'offline (:1234)' },
    { name: 'library', ok: rt.library.files.length > 0, detail: rt.library.roots.length > 0 ? `${rt.library.files.length} GGUF(s)` : 'no library dir (SOVARA_MODELS_DIR)' },
  ];
  const ok = checks.every((c) => c.name === 'gpu' || c.name === 'os' || c.name === 'node' || c.ok || c.name === 'lmstudio' || c.name === 'ollama' || c.name === 'library' ? true : c.ok);
  if (flags.json) return emit({ ok, checks, hardware: hw }, true);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : '----'}  ${c.name}: ${c.detail}`);
  if (!rt.ollama.online && !rt.lmstudio.online && rt.library.files.length === 0) {
    console.log('\nNo local models reachable. Start Ollama/LM Studio or set SOVARA_MODELS_DIR.');
  }
}

async function cmdInstall() {
  const { main } = require('./install-impl');
  await main();
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { help(); return; }
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') { console.log(VERSION); return; }
  if (!cmd) { await cmdStatus({}); console.log('\n(hint: try: sovara chat | sovara hardware --watch | sovara serve --open)'); return; }
  const { _, flags } = parseArgs(rest);
  switch (cmd) {
    case 'install': return cmdInstall();
    case 'hardware': return cmdHardware(flags);
    case 'models': return cmdModels(flags);
    case 'fit': return cmdFit(flags);
    case 'run': return cmdRun(_, flags);
    case 'chat': return cmdChat(flags);
    case 'serve': return cmdServe(flags);
    case 'status': return cmdStatus(flags);
    case 'doctor': return cmdDoctor(flags);
    case 'sessions': {
      const list = listSessions(20);
      if (flags.json) return emit(list, true);
      if (list.length === 0) { console.log('(no CLI sessions yet in ~/.sovara/sessions)'); return; }
      for (const s of list) console.log(`${s.id}  ${s.modifiedAt}  ${s.preview}`);
      return;
    }
    default:
      console.error(`unknown command: ${cmd}\n`);
      help();
      process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`sovara failed: ${e?.message || e}`); process.exitCode = 1; });
}
