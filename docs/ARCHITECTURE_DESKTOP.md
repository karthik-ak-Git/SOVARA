# Sovara Desktop Architecture

**Status:** Current implementation contract  
**Runtime:** Electron + React + TypeScript

## Process model

```text
Electron main process
  ├─ BrowserWindow lifecycle
  ├─ backend composition root
  ├─ AppBackend
  │   ├─ persistence: SQLite + JSONL session events
  │   ├─ model workbench: discovery, load, health, selection
  │   ├─ local llama.cpp runtime: one process per loaded model
  │   ├─ tools: filesystem, shell, MCP, skills, web search
  │   └─ settings and resource snapshots
  └─ typed IPC handlers

Preload
  └─ contextBridge allowlist for invoke channels

Renderer
  └─ React views and client API modules
```

There is no web application process and no Python child process. The only application-owned inference process is the local llama.cpp server used by the model runtime adapter.

## Dependency direction

- Renderer imports shared types and the client API. It does not import Node filesystem, child-process, or model-runtime modules.
- Main owns filesystem, process, network, persistence, and runtime access.
- Shared IPC channel and schema definitions are the contract between Main, preload, and renderer.
- The backend depends on port contracts rather than UI concerns.
- Optional web access is implemented in TypeScript and is explicit; it is not a startup dependency.

## Model loading

1. The workbench discovers models and runtimes.
2. Hardware probing reports CPU, RAM, GPU, and free VRAM.
3. The router ranks compatible models by capability, context size, and measured fit.
4. The llama.cpp adapter selects the runtime executable and GPU layer count.
5. Readiness is verified from the loopback health endpoint before the instance is registered.
6. The instance exposes state and metrics through the existing runtime port.

A failed probe does not fabricate GPU availability. A Ryzen CPU with an NVIDIA GPU is supported when the NVIDIA probe and selected runtime can see that GPU; CPU fallback is explicit.

## Web tools

- `web_search` uses a bounded DuckDuckGo HTML request and returns links, titles, and snippets.
- `web_fetch` uses a bounded TypeScript HTML-to-text reader.
- Redirects to non-HTTP(S) URLs are rejected.
- External content is labeled as untrusted data and is never injected as system instructions.

## Persistence and failure handling

- IPC payloads are validated before reaching Main.
- Session events are appended before dependent work is acknowledged.
- Optional tool failures return structured errors instead of blocking the main chat path.
- Model load/unload state is explicit: offline, loading, active, busy, evicting, or failed.
