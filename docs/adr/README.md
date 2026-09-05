# Architecture Decision Records

Index of binding decisions for SOVARA. Read before changing a boundary.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| 0001 | Modular monolith first, microservices later | Accepted | 2026-09-05 |
| 0002 | Model runtime abstraction (no single-LLM coupling) | Accepted | 2026-09-05 |
| 0003 | Plugin-based tools resolved by name | Accepted | 2026-09-05 |
| 0004 | Isolated agent execution (no host access) | Accepted | 2026-09-05 |
| 0005 | Policy-controlled external network (air-gap ready) | Accepted | 2026-09-05 |
| 0006 | Python FastAPI backend + React/Vite frontend | Accepted | 2026-09-05 |

## Creating a new ADR

1. Copy the lightest template that fits (`0001` is representative).
2. Name it `NNNN-short-title.md`, fill Context → Decision → Consequences.
3. Link superseded/related ADRs; never rewrite an accepted ADR in place.
