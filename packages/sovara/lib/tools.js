'use strict';
// Minimal agentic tools for `sovara run --agent build`.
// Names mirror the desktop capabilities (fs_list/fs_read/fs_search,
// shell_exec) and opencode's read/glob/bash trio.
// plan (default): read-only. build: + gated shell_exec. --yolo skips the prompt.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const MAX_READ_BYTES = 200 * 1024;

function resolveInDir(dir, target) {
  const abs = path.resolve(dir, target);
  const root = path.resolve(dir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('path escapes --dir');
  return abs;
}

function toolRead(dir, target) {
  const abs = resolveInDir(dir, target);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    return fs.readdirSync(abs).slice(0, 200).join('\n');
  }
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(MAX_READ_BYTES + 1);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    let text = buf.subarray(0, Math.min(n, MAX_READ_BYTES)).toString('utf8');
    if (n > MAX_READ_BYTES) text += '\n…(truncated)';
    return text;
  } finally { fs.closeSync(fd); }
}

function toolGlob(dir, pattern) {
  // Tiny glob: supports `*.ext`, `**/*.ext`, or a plain substring.
  const results = [];
  const wantExt = (pattern.match(/\.([a-zA-Z0-9]+)$/) || [])[1];
  const needle = pattern.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^[/\\]+/, '');
  const walk = (d, depth) => {
    if (depth > 6 || results.length >= 200) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (wantExt && !e.name.toLowerCase().endsWith(`.${wantExt.toLowerCase()}`)) continue;
      if (needle && !full.toLowerCase().includes(needle.toLowerCase().replace(/[/\\]/g, ''))) continue;
      results.push(path.relative(dir, full));
      if (results.length >= 200) return;
    }
  };
  walk(path.resolve(dir), 0);
  return results.join('\n');
}

function toolShell(dir, command, { yolo = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!yolo) return reject(new Error('shell_exec needs --yolo (or --agent plan stays read-only)'));
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-Command', command]
      : ['-c', command];
    execFile(shell, args, { cwd: dir, timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${err.message}\n${stderr}`.slice(0, 4000)));
      resolve(String(stdout || stderr || '').slice(0, 8000));
    });
  });
}

// One lightweight tool loop: the model may emit
// ```tool:read path="..."``` / ```tool:glob pattern="..."```
// ```tool:shell command="..."``` and we splice results back in (max 3 rounds).
async function runWithTools({ chat, baseUrl, model, dir, agent, yolo, messages, onTool }) {
  const allowShell = agent === 'build' && yolo;
  let current = messages;
  for (let round = 0; round < 4; round++) {
    const { content } = await chat({ baseUrl, model, messages: current });
    const m = content.match(/```tool:(read|glob|shell)\s+([^`]+)```/);
    if (!m || agent === 'plan') return { content, rounds: round };
    const [, kind, attrStr] = m;
    const attrs = Object.fromEntries([...attrStr.matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    let result;
    try {
      if (kind === 'read') result = toolRead(dir, attrs.path || '.');
      else if (kind === 'glob') result = toolGlob(dir, attrs.pattern || '');
      else result = await toolShell(dir, attrs.command || 'echo ok', { yolo: allowShell });
      onTool?.({ kind, attrs, ok: true });
    } catch (e) {
      result = `tool error: ${e.message}`;
      onTool?.({ kind, attrs, ok: false, error: e.message });
      if (kind === 'shell' && !allowShell) return { content, rounds: round };
    }
    current = [...current, { role: 'assistant', content }, { role: 'user', content: `tool:${kind} result:\n${result}` }];
  }
  return { content: current[current.length - 1]?.content ?? '', rounds: 4 };
}

module.exports = { toolRead, toolGlob, toolShell, runWithTools };
