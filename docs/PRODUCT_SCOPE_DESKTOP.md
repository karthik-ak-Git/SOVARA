# Sovara Desktop Product Scope

**Status:** Current desktop contract  
**Owner:** Product and engineering  
**Last reviewed:** 2026-09-25

## Purpose

Sovara is a Windows desktop AI workbench. The shipped experience is an Electron application with a React renderer and a TypeScript main-process backend. The application manages local models, conversations, workspaces, tools, and artifacts without requiring a second web product or a Python runtime.

## In scope

- Electron desktop lifecycle, secure window creation, and single-instance behavior.
- React renderer for chat, model workbench, library, explore, settings, skills, and context panels.
- TypeScript IPC contracts validated with Zod and exposed through a narrow preload bridge.
- Local model discovery, selection, loading, health checks, and hardware-aware routing.
- Local llama.cpp runtime provisioning and loopback inference.
- SQLite metadata plus append-only session event logs.
- TypeScript-only web search and bounded page reading.
- Local filesystem, shell, MCP, skills, and artifact capabilities behind explicit permission boundaries.
- One light visual system with semantic CSS variables.

## Out of scope

- A hosted web application or web deployment.
- Vercel or Next.js runtime integration.
- Python sidecars, Python virtual environments, Whisper, Flask, crawl4ai, or Python startup provisioning.
- A user-selectable dark, light, or system theme. Sovara is light-only by product decision.
- Cloud inference as a required dependency.

## Runtime principle

The renderer is the product UI. The main process is the trust boundary. Optional capabilities must degrade with an honest message; they must not create hidden startup work or silently claim success.

## User journeys

1. Open Sovara and work in a conversation without a web companion.
2. Attach text, office, PDF, or image files. Text and office formats are parsed locally. Images require a vision-capable model; no OCR sidecar is promised.
3. Discover and load a local model, with the application selecting the runtime based on the available GPU and RAM.
4. Use web search only when explicitly enabled or requested; page results are bounded and treated as untrusted external content.
5. Inspect loaded instances, permissions, logs, and project workspace state in Settings.

## Success criteria

- A clean install starts the window without Python setup, web companion discovery, or theme selection.
- All visible surfaces use the same light token contract.
- Model loading reports the selected runtime and GPU placement truthfully.
- Typecheck, focused tests, full desktop tests, and the desktop build pass.
