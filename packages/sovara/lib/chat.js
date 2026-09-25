'use strict';
// Minimal OpenAI-compatible chat helper. Talks to Ollama (:11434),
// LM Studio (:1234), or a Sovara llama server — same /v1/chat/completions shape.
async function chatCompletion({ baseUrl, model, messages, timeoutMs = 120000, signal }) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const t = setTimeout(() => ctrl.abort(new Error('request timed out')), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('empty completion from model');
    return { content, raw: json };
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener?.('abort', onAbort);
  }
}

// Resolve which local endpoint to use. Mirrors opencode's provider fallback
// idea but local-first: explicit --base-url > --model prefix > auto-detect.
function resolveEndpoint({ baseUrl, model, runtimes }) {
  if (baseUrl) return { baseUrl, model };
  if (model?.startsWith('ollama:')) return { baseUrl: 'http://127.0.0.1:11434', model: model.slice('ollama:'.length) };
  if (model?.startsWith('lmstudio:')) return { baseUrl: 'http://127.0.0.1:1234', model: model.slice('lmstudio:'.length) };
  if (model?.startsWith('sovara:')) {
    const ep = process.env.SOVARA_SERVER_URL || 'http://127.0.0.1:8080';
    return { baseUrl: ep, model: model.slice('sovara:'.length) };
  }
  if (runtimes?.ollama?.online && runtimes.ollama.models.length > 0) {
    return { baseUrl: 'http://127.0.0.1:11434', model: model || runtimes.ollama.models[0].name };
  }
  if (runtimes?.lmstudio?.online && runtimes.lmstudio.models.length > 0) {
    return { baseUrl: 'http://127.0.0.1:1234', model: model || runtimes.lmstudio.models[0].id };
  }
  if (runtimes?.sovara?.online && runtimes.sovara.models.length > 0) {
    const ep = process.env.SOVARA_SERVER_URL || 'http://127.0.0.1:8080';
    return { baseUrl: ep, model: model || runtimes.sovara.models[0].id };
  }
  return { baseUrl: 'http://127.0.0.1:11434', model: model || 'default' };
}

module.exports = { chatCompletion, resolveEndpoint };
