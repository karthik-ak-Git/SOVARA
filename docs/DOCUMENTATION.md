# Sovara Desktop Development Guide

## Project shape

```text
apps/desktop/
  src/main/       Electron main, IPC, persistence, tools, model runtime
  src/preload/    Narrow contextBridge API
  src/renderer/   React UI and client API
  src/shared/     Shared types, IPC channels, schemas
  tests/          Main, renderer, runtime, and sovereignty tests
```

`apps/web` is intentionally absent. The root workspace contains the desktop package only.

## Commands

```powershell
pnpm --filter @sovara/desktop typecheck
pnpm --filter @sovara/desktop test
pnpm --filter @sovara/desktop build
pnpm --filter @sovara/desktop build:win:dir
```

## IPC rules

1. Add or change a channel in `src/shared/ipc/channels.ts`.
2. Add the matching preload allowlist entry.
3. Validate the payload in `src/shared/ipc/schemas.ts`.
4. Register the handler in `src/main/ipc/handlers.ts`.
5. Add a client function in `src/renderer/src/lib/client/api.ts`.
6. Add a focused test for validation and failure behavior.

## Runtime rules

- Main owns Node-only capabilities.
- The renderer consumes view models and emits user intent.
- No Python process may be spawned or provisioned.
- Web search and page reading are explicit TypeScript capabilities.
- Local model load must verify readiness and report GPU or CPU placement honestly.

## Visual rules

- Use semantic CSS variables from `src/renderer/src/theme/global.css`.
- Do not add dark mode or a theme selector.
- Keep reusable component styles in CSS classes.
- Preserve focus, reduced-motion, loading, error, empty, and disabled states.
- Avoid hard-coded colors in new components.

## Verification

Before claiming a change is complete, run typecheck, the focused tests, the full desktop test suite, and a desktop build. For hardware-specific changes, also inspect the runtime log and hardware panel on both NVIDIA and CPU-only configurations.
