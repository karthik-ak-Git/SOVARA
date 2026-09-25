# Sovara Desktop Architecture

Sovara is a Windows x64 Electron desktop application. The renderer never runs a web product or a Python sidecar. Main owns the local runtime and all privileged operations.

## Runtime flow

```text
React renderer
      │ typed IPC
Electron main
      │
      ├── SQLite persistence
      ├── workspace and shell tools
      ├── model discovery and routing
      └── llama-server.exe (CUDA when NVIDIA is detected)
                │
                └── http://127.0.0.1:<port>/v1
```

## Boundaries

- **Renderer:** UI, session state, light theme, and user interaction only.
- **Main:** filesystem, shell, model loading, hardware probing, persistence, and loopback inference.
- **Runtime:** one local `llama-server` process per loaded model.
- **Models:** GGUF files remain in the user-selected library; unloading never deletes weights.
- **Network:** model runtime is loopback-only. Web search is an explicit TypeScript adapter and is disabled by default.

## CUDA policy

1. Probe NVIDIA using `nvidia-smi` and Windows fallback paths.
2. If NVIDIA is detected, prefer the packaged CUDA runtime.
3. Use full GPU offload when the measured model budget fits.
4. Use partial CUDA offload when the model is too large for full VRAM.
5. Use CPU/RAM only when no compatible CUDA runtime exists, the user requests CPU, or CUDA initialization fails.

A Ryzen CPU does not disable an NVIDIA GPU. AMD and Intel adapters are not advertised as CUDA-capable unless a matching runtime is packaged.

## Packaged resources

The Windows installer includes:

- compiled Electron main, preload, and renderer files;
- production Node dependencies;
- `node-llama-cpp` native resources;
- vendored `node-pty` ConPTY binaries;
- the pinned llama.cpp CUDA runtime staged by the build;
- application icons and installer metadata.

The runtime is also recoverable from the user data directory if a packaged resource is unavailable.

## Automatic updates

The main process owns `electron-updater`. It reads the `autoUpdates`, `updateChannel`, and `updateFeedUrl` settings, checks the GitHub release metadata at startup and every six hours, downloads a verified NSIS update, and exposes only a typed status event plus **Restart & Install** to the renderer. The updater never runs from the renderer.

Stable releases use `latest.yml`; beta releases use `latest-beta.yml`. A local build is not an update until its installer, blockmap, and update metadata are uploaded to the same GitHub release.

## Security rules

- Bind inference to `127.0.0.1`.
- Do not expose the local runtime to `0.0.0.0`.
- Never treat GPU presence as proof of GPU offload; observe the selected backend and load result.
- Keep downloaded model files outside the application installation directory.
- Keep tool execution behind the desktop permission boundary.
