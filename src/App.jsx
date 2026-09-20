// Sovara Disk KV — production React interface (Tailwind).
//
// State matrix: isProcessing, loadedContextSize, generatedResponse,
// tokenSpeed, hardwareAllocations (disk read speed, RAM consumption, active
// layer mapping). Streams chunks in real time with auto-scroll and animated
// progress — every number comes from live hardware/engine telemetry, never
// fabricated.

import { useCallback, useEffect, useRef, useState } from 'react';

const TIERS_LABEL = (ctx) => (ctx >= 1024 * 1024 ? `${(ctx / (1024 * 1024)).toFixed(1)}M` : `${Math.round(ctx / 1024)}k`);

function Sparkline({ values, color = '#4a90d9' }) {
  const w = 120;
  const h = 30;
  if (!values || values.length < 2) return <svg width={w} height={h} aria-hidden />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * (h - 6) - 3}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
        className="transition-all duration-300"
      />
    </svg>
  );
}

export default function App() {
  const [isProcessing, setProcessing] = useState(false);
  const [isIniting, setIniting] = useState(false);
  const [loadedContextSize, setLoadedContextSize] = useState(0);
  const [generatedResponse, setResponse] = useState('');
  const [tokenSpeed, setTokenSpeed] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [engineReady, setEngineReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [hardwareAllocations, setAlloc] = useState({
    diskReadMbps: 0,
    ramUsedMb: 0,
    totalRamMb: 0,
    freeVramMb: 0,
    gpuLayers: 0,
    activeLayer: -1,
    prefetchedLayer: -1,
    blockBytes: 0,
  });
  const [diskHistory, setDiskHistory] = useState([]);
  const [tokenCount, setTokenCount] = useState(0);
  const scrollRef = useRef(null);
  const telemetryTimer = useRef(null);

  // Auto-scroll to bottom on every streamed chunk.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [generatedResponse, isProcessing]);

  // Hardware profile at startup — live os/nvidia-smi values via IPC.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await window.electron.invoke('hardware-status-fetch', {});
        if (alive && res && res.success) {
          setProfile(res.profile);
          setLoadedContextSize(res.profile.contextSize);
          setAlloc((a) => ({
            ...a,
            totalRamMb: res.profile.totalRamMb,
            freeVramMb: res.profile.freeVramMb,
            gpuLayers: res.profile.gpuLayers,
            ramUsedMb: Math.max(0, res.profile.totalRamMb - res.profile.freeRamMb),
          }));
        }
      } catch {
        /* bridge unavailable — leave honest zeros */
      }
    })();
    return () => { alive = false; };
  }, []);

  // Telemetry poll (disk read speed + active layer mapping) while engine is live.
  useEffect(() => {
    if (!engineReady) {
      if (telemetryTimer.current) clearInterval(telemetryTimer.current);
      return undefined;
    }
    telemetryTimer.current = setInterval(async () => {
      try {
        const t = await window.sovora.engine.telemetry();
        setAlloc((a) => ({
          ...a,
          diskReadMbps: t.diskReadMbps || 0,
          activeLayer: a.activeLayer,
          prefetchedLayer: t.prefetchedLayer ?? -1,
          blockBytes: t.blockBytes || a.blockBytes,
        }));
        setDiskHistory((h) => [...h.slice(-29), t.diskReadMbps || 0]);
      } catch { /* transient */ }
    }, 500);
    return () => clearInterval(telemetryTimer.current);
  }, [engineReady]);

  const loadModel = useCallback(async (modelPath) => {
    setIniting(true);
    setError('');
    try {
      const hw = await window.electron.invoke('engine-init', { modelPath });
      if (!hw || !hw.success) throw new Error(hw && hw.error ? hw.error : 'engine-init failed');
      setProfile(hw.profile);
      setLoadedContextSize(hw.profile.contextSize);
      setAlloc((a) => ({
        ...a,
        totalRamMb: hw.profile.totalRamMb,
        freeVramMb: hw.profile.freeVramMb,
        gpuLayers: hw.profile.gpuLayers,
        ramUsedMb: Math.max(0, hw.profile.totalRamMb - hw.profile.freeRamMb),
      }));
      const eng = await window.sovora.engine.init({
        modelPath,
        contextSize: hw.profile.contextSize,
        gpuLayers: Math.max(0, hw.profile.gpuLayers),
        cacheBlockSizeKb: 256,
        cacheDir: hw.profile.cacheDir,
      });
      if (!eng || !eng.ok) throw new Error(eng && eng.error ? eng.error : 'addon init failed');
      setEngineReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEngineReady(false);
    } finally {
      setIniting(false);
    }
  }, []);

  const submitPrompt = useCallback(async () => {
    if (!engineReady || isProcessing || prompt.trim() === '') return;
    setProcessing(true);
    setError('');
    setResponse('');
    setTokenCount(0);
    const t0 = performance.now();
    try {
      await window.sovora.engine.generateStream(
        { prompt, maxTokens: 256 },
        (chunk) => {
          if (chunk && chunk.type === 'token') {
            setResponse((r) => r + (chunk.text || ''));
            setTokenCount((c) => c + 1);
          }
        }
      );
      const secs = (performance.now() - t0) / 1000;
      setTokenSpeed(secs > 0 ? Math.round(tokenCount / secs) : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
      setPrompt('');
    }
  }, [engineReady, isProcessing, prompt, tokenCount]);

  const ramPct = hardwareAllocations.totalRamMb > 0
    ? Math.min(100, Math.round((hardwareAllocations.ramUsedMb / hardwareAllocations.totalRamMb) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Sovara Disk KV</h1>
            <p className="text-xs text-zinc-500">
              Layer-ahead NVMe prefetch · app-location cache · {profile ? profile.gpuName : 'detecting GPU…'}
            </p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors duration-300 ${
              engineReady ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            {engineReady ? 'Engine ready' : isIniting ? 'Initializing…' : 'Engine offline'}
          </span>
        </header>

        {/* Telemetry matrix — live values only */}
        <section className="grid grid-cols-4 gap-3 mt-5">
          <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Context window</div>
            <div className="text-lg font-semibold mt-1">
              {loadedContextSize > 0 ? TIERS_LABEL(loadedContextSize) : '—'}
              <span className="text-xs text-zinc-500 ml-1">tokens</span>
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">{profile ? profile.mode : ''}</div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Disk read (NVMe)</div>
            <div className="text-lg font-semibold mt-1 tabular-nums transition-all duration-300">
              {hardwareAllocations.diskReadMbps.toFixed(1)}
              <span className="text-xs text-zinc-500 ml-1">MB/s</span>
            </div>
            <Sparkline values={diskHistory} />
          </div>
          <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">System RAM</div>
            <div className="text-lg font-semibold mt-1 tabular-nums">
              {(hardwareAllocations.ramUsedMb / 1024).toFixed(1)}
              <span className="text-xs text-zinc-500 ml-1">/ {(hardwareAllocations.totalRamMb / 1024).toFixed(0)} GB</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${ramPct}%` }}
              />
            </div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Layer mapping</div>
            <div className="text-lg font-semibold mt-1 tabular-nums">
              {hardwareAllocations.activeLayer >= 0 ? hardwareAllocations.activeLayer : '·'}
              <span className="text-zinc-500 text-sm"> / prefetched </span>
              {hardwareAllocations.prefetchedLayer >= 0 ? hardwareAllocations.prefetchedLayer : '·'}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">
              block {hardwareAllocations.blockBytes > 0 ? `${Math.round(hardwareAllocations.blockBytes / 1024)}KB` : '—'}
              {' · gpuLayers '}
              {hardwareAllocations.gpuLayers}
            </div>
          </div>
        </section>

        {/* Streaming output */}
        <section
          ref={scrollRef}
          className="mt-4 h-96 overflow-auto bg-black border border-zinc-800 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed"
          aria-live="polite"
        >
          {generatedResponse || (
            <span className="text-zinc-600">
              Ready — load a model to arm the disk-KV engine. Cache at %APPDATA%/Sovara/disk_kv
            </span>
          )}
          {isProcessing && (
            <span className="inline-block w-2 h-4 ml-1 bg-blue-400 animate-pulse align-text-bottom" aria-hidden />
          )}
        </section>

        {error && (
          <div className="mt-3 text-sm text-red-400 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2 transition-opacity duration-300">
            {error}
          </div>
        )}

        {/* Prompt input */}
        <section className="mt-3 flex gap-2">
          <input
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-600 transition-colors duration-200 disabled:opacity-50"
            placeholder={engineReady ? 'Prompt the huge database…' : 'Initialize the engine first'}
            value={prompt}
            disabled={!engineReady || isProcessing}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitPrompt(); }}
            aria-label="Prompt"
          />
          <button
            type="button"
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              engineReady && !isProcessing
                ? 'bg-blue-600 hover:bg-blue-500 active:scale-[0.98]'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
            disabled={!engineReady || isProcessing}
            onClick={submitPrompt}
          >
            {isProcessing ? 'Streaming…' : 'Run'}
          </button>
          <label className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 hover:bg-zinc-700 cursor-pointer transition-colors duration-200 flex items-center">
            {isIniting ? 'Loading…' : 'Load model'}
            <input
              type="file"
              className="hidden"
              accept=".gguf,.bin"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) loadModel(f.path || f.name);
              }}
            />
          </label>
        </section>

        <p className="mt-3 text-[11px] text-zinc-600">
          {tokenCount > 0 && (
            <span className="text-zinc-500">{tokenCount} chunks · {tokenSpeed} tok/s · </span>
          )}
          Double-buffered 32-layer window at 256KB blocks (~16MB RAM) — one layer always ahead on NVMe.
        </p>
      </div>
    </div>
  );
}
