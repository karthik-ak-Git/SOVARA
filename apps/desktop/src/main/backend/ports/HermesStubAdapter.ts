import type { HermesPort } from '@shared/types/ports'

export class HermesStubAdapter implements HermesPort {
  available = false as const
  reason = 'Hermes not mounted in Phase 1 — interface only (see docs/ARCHITECTURE_PHASE1.md §5)'
}
