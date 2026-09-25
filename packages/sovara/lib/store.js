'use strict';
// Session store: ~/.sovara/sessions/<id>.jsonl — mirrors opencode's
// --continue / --session / --fork resumption in a dependency-free way.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function sessionsDir() {
  const dir = path.join(os.homedir(), '.sovara', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newSessionId() {
  return `ses_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function sessionPath(id) {
  return path.join(sessionsDir(), `${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`);
}

function appendMessage(id, message) {
  fs.appendFileSync(sessionPath(id), JSON.stringify({ ...message, at: new Date().toISOString() }) + '\n', 'utf8');
}

function readSession(id) {
  try {
    const raw = fs.readFileSync(sessionPath(id), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return null; }
}

function lastSessionId() {
  try {
    const files = fs.readdirSync(sessionsDir()).filter((f) => f.endsWith('.jsonl'));
    if (files.length === 0) return null;
    const sorted = files
      .map((f) => ({ f, t: fs.statSync(path.join(sessionsDir(), f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return sorted[0].f.replace(/\.jsonl$/, '');
  } catch { return null; }
}

function listSessions(limit = 20) {
  try {
    return fs.readdirSync(sessionsDir())
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const p = path.join(sessionsDir(), f);
        const st = fs.statSync(p);
        let preview = '';
        try {
          const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
          const first = lines.length > 0 ? JSON.parse(lines[0]) : null;
          preview = String(first?.content ?? '').slice(0, 80);
        } catch { /* ignore */ }
        return { id: f.replace(/\.jsonl$/, ''), modifiedAt: new Date(st.mtimeMs).toISOString(), preview };
      })
      .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
      .slice(0, limit);
  } catch { return []; }
}

module.exports = { sessionsDir, newSessionId, sessionPath, appendMessage, readSession, lastSessionId, listSessions };
