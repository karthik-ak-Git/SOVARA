# ADR-0001: Modular monolith first, microservices later

## Status

Accepted

## Context

SOVARA must eventually span UI, API, agent runtime, model gateway, knowledge,
tools, and audit. The team is small, the repo is greenfield, and Phase 0 must
run on a single workstation/server. Premature microservices would add network
boundaries, deployment topology, and versioning cost before any capability
exists.

## Decision

Build a **modular monolith**: one FastAPI deployment with strict internal
module boundaries (`api` → `application` → `domain` ← `infrastructure`).
Docker Compose runs backend + frontend + (later) local services on one
network. Split into services only when a measured bottleneck demands it.

## Consequences

Good: single deployable, shared types via domain contracts, fast iteration,
trivial local/air-gapped install.
Bad: must enforce boundaries by discipline (no framework barrier); a noisy
future component (e.g. inference) could contend for resources.
Mitigation: ADRs 0002–0005 keep seams replaceable; resource-heavy runtimes
land as separate Compose services, not in-process.
