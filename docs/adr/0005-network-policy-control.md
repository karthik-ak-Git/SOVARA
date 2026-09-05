# ADR-0005: Policy-controlled external network (air-gap ready)

## Status

Accepted

## Context

Confidential data must remain inside the organization's infrastructure.
Accidental egress (a download here, a telemetry call there) is the failure
mode to prevent. A badge is not enforcement; a choke point is.

## Decision

`NetworkPolicy` (`infrastructure/security/network_policy.py`) is the single
egress gate: deny-by-default, `local_only=True`, empty allowlist, loopback
permitted. All future network-touching code must call `check_egress()`.
Decisions are auditable (`audit_log=True` default). Live posture is exposed
via `GET /api/v1/status`. A real firewall/network-deny layer plugs in behind
this seam later.

## Consequences

Good: every exception is explicit, reviewable, and logged.
Bad: developers must route even benign calls through the gate.
Mitigation: gate is a pure function (no I/O), so compliance is cheap.
