import { useCallback, useEffect, useState } from 'react'
import {
  addRuntime,
  getActiveModel,
  getSystemResources,
  listDiscoveredModels,
  listRuntimes,
  removeRuntime,
  selectModel,
  testRuntimeConnection,
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

  const refresh = useCallback(async (): Promise<void> => {
    const [rt, md, ac] = await Promise.all([listRuntimes(), listDiscoveredModels(), getActiveModel()])
    setRuntimes(rt)
    setModels(md)
    setActive(ac)
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
    })()
    return () => {
      cancelled = true
    }
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
    (runtimeId: string, modelId: string) =>
      runGuarded(`select:${modelId}`, async () => {
        const state = await selectModel(runtimeId, modelId)
        setActive(state)
      }),
    [runGuarded]
  )

  const dismissError = useCallback(() => setError(null), [])

  return { runtimes, models, active, resources, probes, busy, error, dismissError, handleAdd, handleRemove, handleProbe, handleSelect, refresh }
}
