# Sovara Orchestration — Prompt Lab

Derived from [`asgeirtj/system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks) (cloned 2026-09-13 to `D:\SOVARA\test\system_prompts_leaks`).

## What we studied
- **Claude Code Opus 4.6** (`Anthropic/claude-code/claude-code-opus-4.6.md`) — tone, doing-tasks, execution-with-care, tool policy, subagent delegation, memory system.
- **Claude Cowork / Design / Opus 5 / Fable 5.1** — dispatcher, skill catalog, output styles.
- **OpenCode** (`OpenCode/opencode.md`) — concision (<4 lines), no-comments, file-op preference, commit discipline.
- **Cursor / Codex / Gemini CLI** — for contrast on verbosity and tool schemas.

Key pattern: `System → Doing tasks → Execution with care → Tone/style → Tool usage → Agents → Skills → Memory → Session context → Environment`. All leaks separate **role + capabilities + constraints + workflow** before any tool definitions.

## What we built
`SYSTEM_PROMPT.md` at this folder — drop-in system prompt for Sovara's orchestrator (`apps/desktop/src/main/backend/agent.orchestrator` + `apps/desktop/src/main/services/*`).

- **Keeps** Claude Code's battle-tested scaffolding (reversibility checks, parallel agents, memory types).
- **Removes** cloud-only assumptions — adds Sovara sovereignty (local-first LLM, SQLite, Python sidecars, offline voice/crawl).
- **Maps** to Sovara monorepo: `D:\SOVARA` paths, `pnpm -r build` vs Vercel-scoped `apps/web`, `win32/PowerShell 5.1` tool rules.

## Use
- Import as system prompt for local GGUF (`ModelWorkbench`) or hosted fallback.
- Iterate in `test/` without touching `apps/` — promote to `apps/desktop/src/main/backend/orchestrator/systemPrompt.ts` when stable.

## Next steps
- Add eval harness: `test/sovara-orchestration/evals/` with tasks from `apps/desktop/tests` (orchestrator, streaming, ipc.validation).
- Version prompts: `SYSTEM_PROMPT.v1.md` → diff against leak updates.
