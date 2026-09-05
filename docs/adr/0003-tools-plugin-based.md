# ADR-0003: Plugin-based tools resolved by name

## Status

Accepted

## Context

The future agent needs file ops, sandbox, OCR, document generation, and more.
Hard-wiring tools into the agent would couple every new capability to the
agent implementation and complicate permission review.

## Decision

Tools implement the `Tool` ABC (`manifest` + `execute`) and register in
`ToolRegistry` by name. The agent resolves by name at run time. Every tool
declares `ToolPermission`s up front (default `network.none`) plus JSON
input/output schemas and a version.

## Consequences

Good: independent registration, review, and testing; permission-first design.
Bad: registry is in-memory in Phase 0 (no persistence).
Mitigation: persistent catalog is a later infrastructure adapter; the ABC is
unchanged.
