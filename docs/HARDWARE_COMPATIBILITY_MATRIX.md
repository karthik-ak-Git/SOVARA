# Hardware Compatibility Matrix

Sovara decides placement from measured hardware and the runtime that is actually packaged. It does not use the CPU vendor as a reason to disable an NVIDIA GPU.

## Runtime policy

1. Detect NVIDIA with `nvidia-smi` and Windows fallback paths.
2. Use the bundled CUDA `llama-server` for NVIDIA systems.
3. Use full CUDA offload when the GGUF file, context, workspace, and runtime overhead fit.
4. Use partial CUDA offload when a useful layer fit remains.
5. Use CPU/RAM only when no compatible NVIDIA runtime exists, CPU mode was explicitly requested, or CUDA initialization fails.
6. Never report full GPU offload without a successful CUDA load.

## Practical ranges

These are safe starting points for Q4/Q5 GGUF models. The actual file size and free memory are authoritative.

| Hardware | Typical model range | Placement |
|---|---:|---|
| 8 GB RAM, CPU only | 0.5B–3B | CPU/RAM |
| 16 GB RAM, 4–6 GB NVIDIA | 3B–7B | CUDA, full or partial |
| 16–32 GB RAM, 8 GB NVIDIA | 7B–8B | CUDA |
| 32 GB RAM, 12–16 GB NVIDIA | 8B–14B | CUDA |
| 64 GB RAM, 24 GB NVIDIA | 20B–32B | CUDA |
| 128 GB RAM, 48–80 GB NVIDIA | 32B–70B | CUDA when the model fits |
| CPU-only server, 64–128 GB RAM | 3B–14B | CPU/RAM |
| CPU-only server, 256 GB+ RAM | 20B–70B | CPU/RAM when capacity permits |
| AMD/Intel GPU system | Model-size dependent | CPU/RAM until a matching runtime is packaged |

## Test profiles

The deterministic sandbox lives in:

```text
apps/desktop/tests/hardware-sandbox/
```

It covers entry laptops, Ryzen + NVIDIA laptops, AMD/Intel laptops, NVIDIA workstations, CPU servers, and NVIDIA servers.

```powershell
pnpm --filter @sovara/desktop exec vitest run tests/hardware-sandbox/hardware-sandbox.test.ts
```

The sandbox tests routing and fit decisions. It does not replace physical CUDA-driver and inference validation.

## Required physical checks

Record CPU, RAM, GPU, total/free VRAM, runtime path, actual `-ngl`, backend, readiness, inference, and observed VRAM for each supported hardware class.
