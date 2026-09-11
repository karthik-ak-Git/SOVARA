# SOVARA — Sovereign AI Desktop Workbench

On-premise, offline-first AI workbench for confidential industrial work.
Windows desktop app (Electron) — local only, no cloud, no telemetry.

> **Current state (Phase 1):** secure Electron shell, durable session store
> (SQLite + append-only JSONL), mock local chat over session events, and a
> local model workbench (detect → connect → probe → list → select) for
> OpenAI-compatible loopback runtimes (LM Studio, Ollama, vLLM, llama.cpp
> server). **No real inference yet** — chat answers come from a deterministic
> local stub; model load/execution, downloads, RAG, MCP, and agents are
> explicitly out of scope until later phases.
>
> See [docs/ARCHITECTURE_PHASE1.md](docs/ARCHITECTURE_PHASE1.md) for the full
> architecture proposal and boundaries.

## Quick start

Requires Node >= 22 and [pnpm](https://pnpm.io/) 11.x. All commands run from
the repo root:

```sh
pnpm install
pnpm dev            # Electron shell + internal Next.js server (UI + /api)
pnpm dev:web        # Next.js browser dev server only (port 51840)
pnpm typecheck      # tsc --noEmit
pnpm --filter @sovara/desktop test    # vitest suite (101 tests)
pnpm build          # electron-vite production build
pnpm build:win      # Windows installer / unpacked dir (apps/desktop/dist)
```

## Project structure

```text
SOVARA
├── apps/desktop/            # the Electron app (@sovara/desktop)
│   ├── src/main/            # Main process: window, IPC handlers, AppBackend,
│   │                        # ports/adapters, storage, network, config, logging
│   ├── src/preload/         # contextBridge whitelist (window.sovara) only
│   ├── src/shared/          # types + IPC channels/schemas (no runtime code)
│   └── tests/               # vitest: contracts, persistence, IPC, UI, sovereignty
├── apps/web/                # Next.js UI + internal API (the only UI; legacy
│                            # Vite renderer src/renderer was deleted)
├── docs/ARCHITECTURE_PHASE1.md
└── test/                    # read-only reference checkouts (never shipped)
```

## Architecture at a glance

```text
Next.js UI → /api → server services → AppBackend → Ports → Adapters → local runtime
```

- Web UI has **no** `fs` / `child_process` / `electron` / database
  access — everything goes through same-origin `/api` validated with Zod.
- `PersistencePort` is real (SQLite metadata + `events.v1.jsonl` source of
  truth, seq-contiguous). Chat is derived from session events; no messages table.
- `ModelWorkbench` (Commit 6) owns the runtime registry, probing, and active
  model selection behind `CustomOpenAICompatibleAdapter` and a single
  loopback-only `HttpClient` (`http:` + `127.0.0.1`/`localhost`/`::1`, DNS
  verified, redirects re-validated, timeout + size caps). Persistence via the
  existing database; per-request local logging without bodies or secrets.
- `LlmPort`, tool/sandbox/DSH/Hermes/model-lifecycle ports remain stubs.

## Sovereignty guarantees

Default offline. No external network, telemetry, cloud, downloads, or model
execution. CI-equivalent local gates: `sovereignty.test.ts` (no Cordis, no
Python spawn, fetch only inside `HttpClient`), `security.test.ts` (sandbox,
CSP, IPC validation), plus workbench proofs (loopback allow/reject, no cloud
endpoints, web UI isolation, VRAM reported UNKNOWN never fabricated).

## License

MIT — see [LICENSE](LICENSE).
