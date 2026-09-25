# Sovara Product Scope

Sovara is a desktop-only, local-first AI workbench for confidential coding, research, and document work.

## Included

- Local GGUF model discovery and downloads
- Hardware-aware model recommendations
- NVIDIA CUDA inference through the owned `llama-server` runtime
- CPU/RAM fallback when CUDA is unavailable
- Partial GPU offload for models larger than free VRAM
- Local sessions, workspaces, artifacts, and permissions
- Verified Windows automatic updates with stable/beta channels
- Local shell and filesystem tools
- Explicit TypeScript web search and bounded page reading
- Light-only desktop interface

## Excluded

- Hosted web application
- Browser-only product entry point
- Application-owned Python sidecars
- Cloud-required model execution
- Automatic AMD/Intel GPU claims without a packaged backend
- llamafile combined TUI mode
- Diffusion server integration

## Supported platform

| Area | Support |
|---|---|
| OS | Windows x64 |
| UI | Electron + React + TypeScript |
| Model format | GGUF |
| GPU acceleration | NVIDIA CUDA |
| CPU fallback | Supported |
| Server use | One local model process at a time by default |
| Web companion | Removed |

## User promise

Sovara must tell the truth about what it is doing:

- report NVIDIA CUDA only when the runtime can use it;
- report partial offload as partial;
- report CPU/RAM mode when CUDA is unavailable;
- keep model files local;
- keep the inference endpoint on loopback;
- never delete a model when unloading it.

## Release definition

A release is ready only when the installer, packaged resources, typecheck, focused tests, and desktop build pass. Hardware-specific claims additionally require validation on representative laptop and server machines.
