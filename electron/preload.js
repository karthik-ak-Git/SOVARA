// Sovara Disk KV — preload bridge.
//
// contextIsolation is ON: the renderer gets exactly this whitelisted surface,
// no nodeIntegration. The native addon (disk_llama_core) is loaded HERE in
// the isolated preload world and re-exported as promisified helpers, so
// App.jsx never touches require() or raw ipcRenderer.

const { contextBridge, ipcRenderer } = require('electron');

let addon = null;
try {
  // Compiled by node-gyp from binding.gyp (target: disk_llama_core).
  // Falls back to null when the addon is not built yet — the UI degrades
  // honestly (telemetry shows "addon not loaded") instead of crashing.
  // eslint-disable-next-line global-require
  addon = require('../build/Release/disk_llama_core.node');
} catch (err) {
  addon = null;
}

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

function initEngine(config) {
  return new Promise((resolve, reject) => {
    if (!addon || typeof addon.initEngine !== 'function') {
      resolve({ ok: false, error: 'disk_llama_core addon not loaded — run node-gyp rebuild' });
      return;
    }
    try {
      addon.initEngine(config, (err, res) => {
        if (err) reject(new Error(String(err)));
        else resolve(res);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function generateTokenAsync(options) {
  return new Promise((resolve, reject) => {
    if (!addon || typeof addon.generateTokenAsync !== 'function') {
      resolve({ ok: false, error: 'disk_llama_core addon not loaded — run node-gyp rebuild' });
      return;
    }
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const inner = { prompt: options.prompt || '', maxTokens: options.maxTokens || 0 };
    try {
      addon.generateTokenAsync(inner, (err, res) => {
        if (err) {
          reject(new Error(String(err)));
          return;
        }
        resolve(res);
      });
      // Progress messages arrive via the addon's ThreadSafeFunction callback;
      // when a JS callback was supplied we proxy through the same channel by
      // polling telemetry is NOT used — instead the addon's final callback
      // carries the aggregate. Streaming tokens ride generateTokenStream below.
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function generateTokenStream(options, onChunk) {
  if (!addon || typeof addon.generateTokenAsync !== 'function') {
    return Promise.resolve({ ok: false, error: 'disk_llama_core addon not loaded' });
  }
  return new Promise((resolve, reject) => {
    try {
      let lastJson = '';
      const inner = { prompt: options.prompt || '', maxTokens: options.maxTokens || 0 };
      // The addon invokes the SAME callback for progress (with a msg object)
      // and for completion (with err=null, final res). We discriminate by shape.
      addon.generateTokenAsync(inner, (msgOrErr, maybeRes) => {
        if (msgOrErr instanceof Error) {
          reject(msgOrErr);
          return;
        }
        if (msgOrErr && typeof msgOrErr === 'object' && msgOrErr.json) {
          lastJson = msgOrErr.json;
          if (typeof onChunk === 'function') {
            try { onChunk(JSON.parse(msgOrErr.json)); } catch { onChunk({ type: 'raw', text: msgOrErr.json }); }
          }
          return;
        }
        if (msgOrErr === null && maybeRes) {
          resolve(maybeRes);
          return;
        }
        if (typeof msgOrErr === 'string' && lastJson === '') {
          // Legacy shape: callback(errString, result)
          resolve({ ok: true, response: msgOrErr });
          return;
        }
        resolve({ ok: true, response: lastJson || 'stream-complete' });
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function hardwareTelemetry() {
  if (!addon || typeof addon.hardwareTelemetry !== 'function') {
    return Promise.resolve({ ready: false, diskReadMbps: 0, prefetchedLayer: -1, blockBytes: 0 });
  }
  try {
    return Promise.resolve(addon.hardwareTelemetry());
  } catch {
    return Promise.resolve({ ready: false, diskReadMbps: 0, prefetchedLayer: -1, blockBytes: 0 });
  }
}

contextBridge.exposeInMainWorld('sovora', {
  invoke,
  engine: {
    init: initEngine,
    generate: generateTokenAsync,
    generateStream: generateTokenStream,
    telemetry: hardwareTelemetry,
  },
});

contextBridge.exposeInMainWorld('electron', { invoke });
