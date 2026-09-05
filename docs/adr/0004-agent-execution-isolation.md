# ADR-0004: Isolated agent execution (no host access)

## Status

Accepted

## Context

An agent with arbitrary host shell/filesystem access is the highest-risk
element of an agentic workbench, especially for confidential industrial work.
The architecture must make unrestricted execution unrepresentable.

## Decision

The agent (contract in `domain/agent.py`, loop deferred) executes **only**
through registered `Tool`s inside controlled boundaries. There is no shell
primitive, no host-FS path passing, and no direct tool imports in agent code.
`ToolPermission.CODE_EXEC_SANDBOXED` marks the future sandbox seam; scoped
file handles arrive with it.

## Consequences

Good: blast radius is bounded by tool permissions from day one.
Bad: some legitimate workflows need handle-plumbing design later.
Mitigation: design scoped resource handles as part of the sandbox phase, not
as an afterthought.
