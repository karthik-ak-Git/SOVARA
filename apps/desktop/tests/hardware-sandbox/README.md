# Hardware sandbox

This folder contains deterministic, test-only hardware profiles. It does not read the developer laptop and does not spawn `llama-server`.

Run it from the repository root:

```powershell
pnpm --filter @sovara/desktop exec vitest run tests/hardware-sandbox/hardware-sandbox.test.ts
```

The profiles cover:

- Entry CPU-only laptop
- Ryzen CPU + NVIDIA laptop GPU
- AMD GPU laptop without a packaged CUDA runtime
- Intel GPU laptop without a packaged CUDA runtime
- NVIDIA workstation
- CPU-only server
- NVIDIA server

The expected policy is:

- NVIDIA profiles use the owned CUDA runtime and full GPU offload when the model fits.
- Ryzen CPU does not override NVIDIA GPU detection.
- AMD/Intel profiles are tested as CPU/RAM placement because the current owned runtime does not package their GPU backend.
- CPU-only profiles are tested as CPU/RAM placement.
