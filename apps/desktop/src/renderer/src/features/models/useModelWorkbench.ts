import { useCallback, useEffect, useState } from 'react'
import {
  addRuntime,
  ensureLocalRuntime,
  getActiveModel,
  getSystemResources,
  listDiscoveredModels,
  listRuntimes,
  listLibraryModels,
  onDownloadEvents,
  probeLocalRuntime,
  removeRuntime,
  selectModel,
  testRuntimeConnection,
  type LocalRuntimeStatus,
  type SystemResourcesView,
} from '../../lib/ipc'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry, RuntimeProbeResult } from '@shared/types/models'

/**
 * Commit 6 — Models workbench state.
 * Registry + probe results + selection, all server-owned. React holds no
 * endpoint strings beyond form drafts and no selection beyond the mirror.
 */
export function useModelWorkbench() {
  const [runtimes, setRuntimes] = useState<ModelRuntimeEntry[]>([])
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [active, setActive] = useState<ActiveModelState>({ selection: null, available: false })
  const [resources, setResources] = useState<SystemResourcesView | null>(null)
  const [probes, setProbes] = useState<Record<string, RuntimeProbeResult>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Owned runtime (Sovara's own llama.cpp sidecar — no Ollama/LM Studio needed)
  const [localRuntime, setLocalRuntime] = useState<LocalRuntimeStatus | null>(null)
  const [runtimeProgress, setRuntimeProgress] = useState<{ phase: string; receivedBytes: number; totalBytes: number | null } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [rt, md, ac, libRaw] = await Promise.all([listRuntimes(), listDiscoveredModels(), getActiveModel(), listLibraryModels().catch(() => [])])
    const lib = Array.isArray(libRaw) ? libRaw : []
    // Merge library files as local-discovered models so chat selector is library-driven (dynamic, not hardcoded)
    const libModels: DiscoveredModel[] = lib.map((m) => ({
      modelId: m.name.replace(/\.gguf$/i, '').replace(/__/g, '/') || m.file.replace(/\.gguf$/i, ''),
      displayName: m.file,
      runtimeId: rt[0]?.id ?? 'local',
      source: 'custom' as const,
      capabilities: [],
      available: true,
    }))
    const merged = [...md]
    for (const lm of libModels) if (!merged.some((x) => x.modelId === lm.modelId)) merged.push(lm)
    // ensure at least one local runtime entry for the pill label
    let runtimesOut = rt
    if (libModels.length > 0 && rt.length === 0) {
      runtimesOut = [{ id: 'local', displayName: 'Local Library', type: 'openai-compatible' as const, endpoint: 'local', enabled: true, timeoutMs: 8000 }]
    }
    setRuntimes(runtimesOut)
    setModels(merged)
    // auto-select first library model if nothing selected (only when library provides a model)
    if (!ac.selection && libModels.length > 0) {
      try { const s = await selectModel(libModels[0].runtimeId, libModels[0].modelId); setActive(s); } catch { setActive(ac) }
    } else setActive(ac)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await refresh()
        const res = await getSystemResources()
        if (!cancelled) setResources(res)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
      try {
        const status = await probeLocalRuntime()
        if (!cancelled) setLocalRuntime(status)
      } catch {
        if (!cancelled) setLocalRuntime({ available: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  // Runtime-install progress (modelId `__sovara_runtime__` on the shared channel)
  useEffect(() => {
    const dispose = onDownloadEvents((ev) => {
      if (ev.modelId !== '__sovara_runtime__') return
      if (ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled') {
        setRuntimeProgress(null)
        void probeLocalRuntime().then(setLocalRuntime).catch(() => {})
        void refresh().catch(() => {})
      } else {
        setRuntimeProgress({ phase: ev.state, receivedBytes: ev.receivedBytes, totalBytes: ev.totalBytes })
      }
    })
    return dispose
  }, [refresh])

  const runGuarded = useCallback(
    async (key: string, fn: () => Promise<void>): Promise<void> => {
      if (busy) return
      setBusy(key)
      setError(null)
      try {
        await fn()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [busy]
  )

  const handleAdd = useCallback(
    (displayName: string, endpoint: string) =>
      runGuarded('add', async () => {
        await addRuntime({ displayName, endpoint })
        await refresh()
      }),
    [runGuarded, refresh]
  )

  const handleRemove = useCallback(
    (runtimeId: string) =>
      runGuarded(`remove:${runtimeId}`, async () => {
        await removeRuntime(runtimeId)
        await refresh()
      }),
    [runGuarded, refresh]
  )

  const handleProbe = useCallback(
    (runtimeId: string) =>
      runGuarded(`probe:${runtimeId}`, async () => {
        const result = await testRuntimeConnection(runtimeId)
        setProbes((p) => ({ ...p, [runtimeId]: result }))
        await refresh()
      }),
    [runGuarded, refresh]
  )

  const handleSelect = useCallback(
    async (runtimeId: string, modelId: string): Promise<void> => {
      // Model switching must never appear dead because another workbench
      // op (probe/install) holds the shared `busy` guard — select owns
      // its lifecycle and surfaces errors directly.
      setError(null)
      try {
        const state = await selectModel(runtimeId, modelId)
        setActive(state)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    []
  )

  const handleEnsureRuntime = useCallback(
    () =>
      runGuarded('ensure-runtime', async () => {
        setRuntimeProgress({ phase: 'starting', receivedBytes: 0, totalBytes: null })
        try {
          await ensureLocalRuntime()
        } finally {
          const status = await probeLocalRuntime().catch(() => ({ available: false }) as LocalRuntimeStatus)
          setLocalRuntime(status)
          setRuntimeProgress(null)
          await refresh()
        }
      }),
    [runGuarded, refresh]
  )

  const dismissError = useCallback(() => setError(null), [])

  return { runtimes, models, active, resources, probes, busy, error, dismissError, handleAdd, handleRemove, handleProbe, handleSelect, handleEnsureRuntime, localRuntime, runtimeProgress, refresh }
}
