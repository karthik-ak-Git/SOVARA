# Sovara Landing Page

The public website for Sovara, the Windows x64 desktop-only local AI workbench.

This folder is the marketing and documentation site for the desktop application. It is not the application runtime.

## Current desktop release

```text
Sovara 1.1.3
```

The desktop application is distributed as:

```text
Sovara-Setup-1.1.3-x64.exe
```

## User installation

Download the `.exe` from the GitHub release page, or use:

```powershell
npx --yes sovara@latest
```

The installed desktop application does not require Python, LM Studio, Ollama, or a separate Node.js runtime. Node.js is required only for the npx installer.

## Current product promises

- Windows x64 desktop application.
- Local GGUF inference through the packaged llama.cpp runtime.
- NVIDIA CUDA support when a supported NVIDIA GPU is detected.
- CPU/RAM fallback when CUDA is unavailable or a model does not fit VRAM.
- Local sessions, models, tools, and audit history.
- No application-owned Python sidecars.
- Light-only desktop interface.
- Automatic Windows updates through GitHub Releases.

## Development

From this folder:

```bash
pnpm install
pnpm dev
```

Open:

```text
http://localhost:3000
```

Build and serve the production site:

```bash
pnpm build
pnpm start
```

## Source links

- Desktop repository: https://github.com/karthik-ak-Git/SOVARA
- Releases: https://github.com/karthik-ak-Git/SOVARA/releases
- Desktop documentation: https://github.com/karthik-ak-Git/SOVARA/tree/main/docs
