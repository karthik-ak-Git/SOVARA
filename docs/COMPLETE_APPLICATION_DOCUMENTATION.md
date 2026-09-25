# Sovara Application Documentation

**Status:** Current desktop-only documentation

## Overview

Sovara is a Windows Electron desktop application for local AI work. The application provides React views for chat, models, library, explore, skills, context, and settings, backed by a TypeScript main process.

## Runtime

- Electron main process and secure BrowserWindow.
- React 18 renderer with Vite.
- SQLite metadata and append-only session event persistence.
- Local llama.cpp inference over loopback HTTP.
- TypeScript-only web search and bounded page extraction.
- No hosted web application, web companion, or Python sidecar.

## Removed capabilities

Voice transcription, OCR sidecars, Python provisioning, crawl4ai, and the Laya Python decision manager were removed. Image attachments require a vision-capable local model; unsupported images are reported honestly rather than routed through a hidden OCR process.

## User settings

Settings includes model, agent, usage, notification, workspace, layout, and runtime controls. Preferences contains layout options only. Theme is fixed to light; dark and system options are not exposed or persisted by the current settings contract.

## Model placement

The application probes NVIDIA VRAM using PATH-independent Windows `nvidia-smi` locations. If no NVIDIA GPU is detected, the runtime may use CPU or shared system memory and must say so in the UI and logs.

## Developer commands

```powershell
pnpm --filter @sovara/desktop typecheck
pnpm --filter @sovara/desktop test
pnpm --filter @sovara/desktop build
```

## Documentation map

- Product scope: `PRODUCT_SCOPE_DESKTOP.md`
- Architecture: `ARCHITECTURE_DESKTOP.md`
- Visual system: `DESIGN_SYSTEM_LIGHT.md`
- Component and IPC contracts: `COMPONENT_CONTRACTS.md`
- Change plan: `IMPLEMENTATION_PLAN.md`
- Release gate: `VERIFICATION_RELEASE.md`
