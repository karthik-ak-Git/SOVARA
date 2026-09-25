# Sovara Component and IPC Contracts

**Status:** Current implementation contract

## Renderer components

### `App`

- Owns application-level view routing and settings hydration.
- Applies the light theme before and after asynchronous settings loading.
- Must not access filesystem or process APIs directly.

### `Composer`

- Owns message text, attachment selection, send/cancel behavior, and web-search opt-in.
- Removed: microphone capture and Python transcription.
- Attachments are sent as bounded IPC payloads; unsupported image analysis is explained in context rather than routed to an OCR sidecar.

### `ModelSelector` and `ProjectSelector`

- Present typed view models and emit selection events.
- Do not persist theme or runtime state themselves.
- Display unavailable options honestly and preserve keyboard navigation.

### `ChatView`, `ContextPanel`, and artifact components

- Render stream events and model context metadata.
- Treat external web text as untrusted content.
- Use semantic classes and tokens for surfaces, status, code blocks, and empty states.

### `SettingsModal`

- Settings are grouped by product capability.
- Preferences contain layout settings only; there is no theme picker.
- Python provisioning, voice, OCR, and web-companion settings are not exposed.

## IPC contract

Every channel is declared in `src/shared/ipc/channels.ts` and must have a matching preload allowlist entry. Payloads are parsed with the corresponding Zod schema in `src/shared/ipc/schemas.ts`.

```text
renderer client API
  → preload alias
    → ipcRenderer.invoke(channel, payload)
      → zod validation
        → Main handler
          → backend port/service
```

Removed channels include Python setup, voice transcription/status, OCR recognition, and the web companion API. Do not reintroduce them without a new product decision and a TypeScript replacement contract.

## Tool contract

- Tool definitions have names, descriptions, JSON parameter schemas, and bounded execution policies.
- `web_search` and `web_fetch` are TypeScript-only capabilities.
- File and shell tools require the existing execution permission mode.
- MCP tools are dynamically discovered from configured servers and remain behind the tool port.

## Error contract

Tool and runtime errors should be user-readable, structured, and actionable. Do not use a generic success shape when the operation was skipped or unavailable.
