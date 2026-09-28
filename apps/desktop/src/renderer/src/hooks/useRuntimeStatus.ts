import { useEffect, useState } from 'react'
import {
  initRuntimeStatusStore,
  getCanonicalRuntimeState,
  getDiagnosticLogs,
  subscribeRuntimeStatus,
} from '../stores/runtimeStatusStore'
import type { CanonicalRuntimeState, DiagnosticEventLogEntry } from '@shared/types/agentEvents'

export function useRuntimeStatus(): {
  runtimeState: CanonicalRuntimeState
  diagnosticLogs: DiagnosticEventLogEntry[]
} {
  const [state, setState] = useState<CanonicalRuntimeState>(getCanonicalRuntimeState())
  const [logs, setLogs] = useState<DiagnosticEventLogEntry[]>(getDiagnosticLogs())

  useEffect(() => {
    initRuntimeStatusStore()

    const unsub = subscribeRuntimeStatus((nextState) => {
      setState(nextState)
      setLogs(getDiagnosticLogs())
    })

    return () => {
      unsub()
    }
  }, [])

  return { runtimeState: state, diagnosticLogs: logs }
}
