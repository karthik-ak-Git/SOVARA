# @sovara/web — Sovara on Next.js

Next.js (App Router) frontend + internal server/API layer for Sovara.
Migrated from the Electron React renderer **without redesign and without
replacing working functionality**.

## Architecture

```
Browser
  ↓  fetch (lib/client/api.ts) + SSE (EventSource)
Next.js UI (app/page.tsx → src/App.tsx, Client Components)
  ↓
Next.js internal API (app/api/*, ~60 routes)
  ↓
Server service layer (src/lib/server/*.ts — thin typed facades)
  ↓
Sovora backend (apps/desktop/src/main/** — AppBackend, ports, services)
  ↓
Local model runtime / SQLite / filesystem / hardware / MCP / sidecars
```

Key principles:

- **No duplication.** Shared types come from `apps/desktop/src/shared`
  via the `@shared/*` alias. The entire backend (persistence, model
  runtime, inference, agents, skills, MCP, validation, downloads) is reused
  from `apps/desktop/src/main` via `@sovara-main/*`. The only Electron
  usage in that code is `app.getPath/getVersion/getAppPath/isReady`, which
  is aliased (server builds only) to `src/lib/server/electron-shim.ts`
  backed by `SOVARA_DATA_DIR` / OS app-data paths.
- **Same data.** Default data dir = the OS app-data `Sovara` folder, so the
  web server and the Electron app share one SQLite DB, registry, and library.
- **Same contracts.** API routes mirror the IPC handlers 1:1 (same Zod
  schemas, same shapes, same error strings incl. `no-active-model:`).
  Push channels (`events:session/download/instances`) are SSE endpoints.

## Run

```sh
# dev (port 51840)
pnpm dev:web        # from repo root, or pnpm dev inside apps/web

# production
pnpm build:web
pnpm start:web

# typecheck
pnpm typecheck:web
```

Isolate data during testing:

```sh
SOVARA_DATA_DIR=/tmp/sovara-web-test pnpm dev:web
```

Copy `.env.example` → `.env.local` for local overrides. Server secrets must
never use the `NEXT_PUBLIC_` prefix.

## API map (see app/api)

| Domain | Routes |
|---|---|
| app/system | `GET /api/app/info`, `GET /api/hardware`, `GET /api/hardware/profile`, `GET /api/explore/hardware` |
| sessions | `GET/POST /api/sessions`, `GET/PATCH/DELETE /api/sessions/[id]`, `GET …/events`, `POST …/archive`, `POST …/unarchive`, `GET /api/sessions/archived` |
| projects | `GET/POST /api/projects`, `PATCH/DELETE /api/projects/[id]` |
| chat | `POST /api/chat`, `POST /api/chat/cancel`, `POST /api/chat/regenerate`, `POST /api/chat/edit-resend`, `GET /api/chat/stream` (SSE) |
| models | `GET /api/models/local`, `POST /api/models/probe`, `POST /api/models/load`, `POST /api/models/ensure-runtime`, `GET /api/models`, `POST /api/models/select`, `GET /api/models/active` |
| runtimes | `GET/POST /api/runtimes`, `DELETE /api/runtimes/[id]`, `POST …/probe` |
| registry | `GET/PATCH/DELETE /api/registry`, `POST /api/registry/remove-by-path` |
| instances | `GET /api/instances`, `POST /api/instances/[id]/unload`, `GET …/metrics`, `GET /api/instances/events` (SSE) |
| settings | `GET/PATCH /api/settings`, `GET /api/settings/version`, `POST /api/settings/check-updates` |
| exec/tools/usage | `GET/PUT /api/exec/mode`, `GET /api/tools`, `POST /api/tools/dispatch`, `GET /api/usage/total`, `GET /api/usage/by-model`, `GET /api/usage/recent` |
| skills | `GET /api/skills/sources`, `POST …/toggle`, `GET/POST /api/skills/bionic`, `DELETE …/[id]`, `GET /api/skills/detailed`, `POST /api/skills/import` |
| explore | `POST /api/explore/models`, `GET /api/explore/models/[id]`, `GET …/compatibility`, `GET …/recommendations` |
| library | `GET/DELETE /api/library`, `GET/POST /api/library/directory`, `GET …/locations`, `POST …/download`, `POST …/cancel`, `POST …/pause`, `POST …/resume`, `GET …/downloads`, `POST …/is-downloaded`, `POST …/file-status`, `POST …/reconcile`, `POST …/open-folder`, `GET …/events` (SSE) |
| validation | `GET/POST /api/validation`, `GET /api/validation/[jobId]`, `GET /api/validation/cache` |
| connections | `GET/POST /api/connections`, `POST …/install`, `GET …/dir`, `POST …/open-folder`, `DELETE …/[id]`, `POST …/[id]/toggle`, `POST …/[id]/probe` |
| voice/setup/logs | `GET /api/voice/status`, `POST /api/voice/transcribe`, `GET/POST /api/setup/python`, `GET /api/logs` |

## Known web limitations (documented, not regressions)

- `dialog:pickFolder` has no web equivalent — project/library paths are
  entered manually; the modal already supports that.
- `window:minimize/maximize/close` are Electron-only — controls are hidden
  outside the Electron shell (auto-detected).
- `library:openFolder` / `mcp:openFolder` resolve and return the trusted
  path for display instead of opening a native explorer.
- `shell:openExternal` opens the allowlisted URL in a new tab (same
  Hugging Face/GitHub allowlist the Electron shell enforces).
