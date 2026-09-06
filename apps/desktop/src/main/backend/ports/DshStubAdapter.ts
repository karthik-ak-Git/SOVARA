import type { DshPort } from '@shared/types/ports'

export class DshStubAdapter implements DshPort {
  available = false as const
  reason = 'DSH not mounted in Phase 1 — interface only (see docs/ARCHITECTURE_PHASE1.md §4)'
}
