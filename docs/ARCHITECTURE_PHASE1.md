# Sovara Desktop Architecture

**Status:** Current desktop architecture  
**Last reviewed:** 2026-09-25

This document supersedes the earlier Phase 1 proposal. Sovara is now a desktop-only Electron application. The React renderer is the only product UI. The TypeScript main process is the trust boundary, and there is no web deployment or Python runtime in the shipped application.

## Boundaries

```text
React renderer
  → preload allowlist
    → Zod-validated IPC
      → AppBackend
        ├─ SQLite + append-only session events
        ├─ ModelWorkbench and local llama.cpp runtime
        ├─ filesystem, shell, MCP, and skills tools
        ├─ explicit TypeScript web search/page reader
        └─ settings and hardware snapshots
```

### Renderer

React views may call the client API and consume shared typed view models. They do not import Electron, Node filesystem, child-process, or model-runtime modules.

### Main

Main owns process lifecycle, file access, local model processes, network policy, persistence, and permission enforcement. Main registers all IPC handlers in one composition root.

### Preload

Preload exposes only the channels in `src/shared/ipc/channels.ts`. Raw `ipcRenderer` is not exposed to the renderer.

### Local inference

The owned runtime is a local `llama-server` process accessed over loopback. The model adapter verifies readiness before registering an instance. Hardware placement is based on measured GPU/VRAM and is never fabricated when probing fails.

## Removed runtime surfaces

The following are intentionally not part of the product:

- `apps/web` and the Vercel/Next.js deployment.
- Python sidecars and Python virtual-environment provisioning.
- Whisper voice transcription and microphone capture.
- Crawl4ai/Flask web crawling.
- The Python-backed Laya decision manager.
- Theme selection, dark mode, and system-theme listening.

Web search and page reading remain available through explicit TypeScript-only functions in `src/main/services/webSearch.ts`.

## Data and security

- Session metadata is stored in SQLite and session events are append-only JSONL.
- IPC payloads are parsed with Zod before backend use.
- Shell and filesystem actions use the existing execution permission mode.
- External web content is untrusted data and is bounded before entering model context.
- The renderer is sandboxed, context-isolated, and has no Node integration.

## Related documents

- `ARCHITECTURE_DESKTOP.md`
- `PRODUCT_SCOPE_DESKTOP.md`
- `COMPONENT_CONTRACTS.md`
- `DESIGN_SYSTEM_LIGHT.md`
- `VERIFICATION_RELEASE.md`
