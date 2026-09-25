# Sovara Desktop Verification and Release

**Status:** Release gate  
**Target:** Windows x64 desktop installer

## Required checks

Run from the repository root:

```powershell
pnpm --filter @sovara/desktop typecheck
pnpm --filter @sovara/desktop test
pnpm --filter @sovara/desktop build
```

For a packaging check:

```powershell
pnpm --filter @sovara/desktop build:win:dir
```

## Focused regression checks

```powershell
pnpm --filter @sovara/desktop exec vitest run tests/sovereignty.test.ts
pnpm --filter @sovara/desktop exec vitest run tests/attachments.artifacts.test.ts
pnpm --filter @sovara/desktop exec vitest run tests/llama.runtime.test.ts
```

## Clean-install checks

- Uninstall the prior Sovara package or use a fresh Windows user data directory.
- Confirm the app window opens without Python, pip, a browser download, or a web companion.
- Confirm Settings contains Preferences but no theme picker, Python engine, voice, or OCR controls.
- Confirm the renderer uses a light background and native controls use light color scheme.
- Load a model on an AMD Ryzen system with an NVIDIA GPU. Verify the hardware panel names the GPU and the runtime log reports GPU layers rather than silently claiming CPU placement.
- Test CPU-only fallback with no NVIDIA driver and confirm the UI reports CPU/shared-memory mode honestly.

## Packaged resource gate

The installer must not contain:

- `resources/python`
- `whisper_server.py`
- `crawl_server.py`
- Python virtual environments
- a Vercel/Next.js web application

The application may still use Python indirectly as a native-build prerequisite of `node-gyp`; that is a build-time tool requirement, not a shipped runtime or application script.

## Release notes template

- Sovara now ships as a desktop-only application.
- The web deployment and local web companion have been removed.
- Python sidecars, voice transcription, OCR sidecar paths, and Python provisioning are no longer part of the product.
- The renderer uses a single light visual system.
- Local model routing reports NVIDIA/CPU placement more reliably on Windows.
- Web search remains available through an explicit TypeScript-only adapter.
