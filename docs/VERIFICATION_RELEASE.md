# Release Verification

This is the release checklist for the Windows x64 desktop application.

## Automated checks

Run from the repository root:

```powershell
pnpm --filter @sovara/desktop typecheck
pnpm --filter @sovara/desktop test
pnpm --filter @sovara/desktop build
```

Focused hardware and runtime checks:

```powershell
pnpm --filter @sovara/desktop exec vitest run tests/hardware-sandbox/hardware-sandbox.test.ts
pnpm --filter @sovara/desktop exec vitest run tests/llama.runtime.test.ts
pnpm --filter @sovara/desktop exec vitest run tests/model.lifecycle.test.ts
```

## Windows package check

```powershell
pnpm --filter @sovara/desktop build:win:dir
```

The build stages the pinned llama.cpp CUDA runtime and the ConPTY resources before packaging. Inspect `apps/desktop/dist/` and confirm the unpacked application contains:

- `llama-server.exe` and CUDA DLLs under packaged `llama-runtime`;
- `pty/node-pty` native files;
- compiled main, preload, and renderer files;
- no Python runtime or application-owned Python sidecar.

## Clean-machine checks

- Install from the `.exe` on a clean Windows user profile.
- Launch without Python, pip, LM Studio, or Ollama installed.
- Confirm a model can be downloaded and loaded locally.
- Confirm NVIDIA systems report CUDA and GPU layers.
- Confirm CPU-only systems report CPU/RAM honestly.
- Confirm partial offload is labelled partial.
- Confirm unload releases the process without deleting weights.

## Installer check

The `npx --yes sovara@latest` command must:

1. fetch the pinned Sovara release;
2. select the Windows installer asset;
3. download it to a temporary path;
4. verify the release digest when GitHub provides one;
5. launch the installer without a shell command string.

## Automatic updates

Sovara uses `electron-updater` with a GitHub Releases provider. The app checks at startup and every six hours when **Automatic Updates** is enabled, downloads the new NSIS package in the background, and exposes **Restart & Install** in Settings → General after the download is verified.

For a release, upload these files together to the `Sovara-versions` GitHub release:

```text
Sovara-Setup-1.1.5-x64.exe
Sovara-Setup-1.1.5-x64.exe.blockmap
latest.yml
```

The release must contain the versioned installer, its blockmap, and `latest.yml`. The `npx --yes sovara@latest` installer and the in-app updater must point at the same release. Beta builds use `latest-beta.yml` and the `build:win:beta` command.

The updater is skipped in unpackaged development builds. A production build also needs a Windows code-signing certificate before release; unsigned builds can update, but Windows SmartScreen may warn users.

## Physical hardware matrix

Validate at least one machine in each available class:

- CPU-only laptop;
- NVIDIA laptop;
- Ryzen CPU + NVIDIA GPU;
- NVIDIA workstation;
- CPU-only server;
- NVIDIA server.

Do not claim a hardware range is verified from unit tests alone. Record the actual runtime path, `-ngl`, backend, readiness, inference, and observed VRAM.
