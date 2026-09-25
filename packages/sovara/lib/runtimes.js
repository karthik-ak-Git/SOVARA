'use strict';
// Local runtime detection ported from
// apps/desktop/src/main/services/localRuntimeDetector.ts (+ modelLocations scan).
// Probes Ollama :11434, LM Studio :1234, Sovara llama server, and scans the
// Sovara model library + Ollama/LM Studio model dirs on disk.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TIMEOUT_MS = 2500;

async function httpGetJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function probeOllama(endpoint = 'http://127.0.0.1:11434') {
  const tags = await httpGetJson(`${endpoint}/api/tags`);
  if (!tags || !Array.isArray(tags.models)) return { online: false, models: [], activeModels: [] };
  const ps = await httpGetJson(`${endpoint}/api/ps`);
  const active = new Set((ps?.models ?? []).map((m) => m.name || m.model));
  return {
    online: true,
    models: tags.models.map((m) => ({
      name: m.name, modelId: `ollama:${m.name}`, runtime: 'ollama',
      sizeBytes: m.size ?? 0, sizeGB: Math.round(((m.size ?? 0) / 1024 ** 3) * 100) / 100,
      parameterSize: m.details?.parameter_size, quantization: m.details?.quantization_level,
      isVramActive: active.has(m.name),
    })),
    activeModels: [...active],
  };
}

async function probeLmStudio(endpoint = 'http://127.0.0.1:1234') {
  const data = await httpGetJson(`${endpoint}/v1/models`);
  if (!data || !Array.isArray(data.data)) return { online: false, models: [] };
  return {
    online: true,
    models: data.data.map((m) => ({ name: path.basename(m.id), modelId: `lmstudio:${m.id}`, runtime: 'lmstudio', id: m.id })),
  };
}

async function probeSovaraServer(endpoint) {
  if (!endpoint) return { online: false, models: [] };
  const data = await httpGetJson(`${endpoint.replace(/\/$/, '')}/v1/models`);
  if (!data || !Array.isArray(data.data)) return { online: false, models: [] };
  return { online: true, models: data.data.map((m) => ({ name: m.id, modelId: `sovara:${m.id}`, runtime: 'sovara', id: m.id })) };
}

function walkGguf(root, out) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) { walkGguf(full, out); continue; }
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.gguf')) continue;
    const b = e.name.toLowerCase();
    if (b.includes('mmproj') || b.includes('vocab') || b.includes('tokenizer')) continue;
    try {
      const st = fs.statSync(full);
      out.push({ name: e.name, file: e.name, sizeBytes: st.size, sizeGB: Math.round((st.size / 1024 ** 3) * 100) / 100, path: full, source: 'filesystem' });
    } catch { /* skip */ }
  }
}

function sovaraLibraryDirs() {
  const dirs = [];
  const home = os.homedir();
  const candidates = [
    process.env.SOVARA_MODELS_DIR,
    process.env.SOVARA_MODEL_DIR,
    path.join(home, '.sovara', 'models'),
    path.join(home, 'Sovara', 'models'),
  ];
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Sovara', 'models'));
  for (const d of candidates) {
    if (d && fs.existsSync(d)) dirs.push(d);
  }
  return [...new Set(dirs)];
}

function scanSovaraLibrary() {
  const out = [];
  for (const root of sovaraLibraryDirs()) walkGguf(root, out);
  return { roots: sovaraLibraryDirs(), files: out.sort((a, b) => b.sizeBytes - a.sizeBytes) };
}

async function detectRuntimes(sovaraEndpoint) {
  const [ollama, lmstudio, sovara] = await Promise.all([
    probeOllama(), probeLmStudio(), probeSovaraServer(sovaraEndpoint),
  ]);
  const library = scanSovaraLibrary();
  const totalLocalModels = ollama.models.length + lmstudio.models.length + library.files.length;
  return { ollama, lmstudio, sovara, library, totalLocalModels };
}

module.exports = { probeOllama, probeLmStudio, probeSovaraServer, scanSovaraLibrary, detectRuntimes };
