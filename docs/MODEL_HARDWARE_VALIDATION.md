# Model and Hardware Validation

Validation answers two separate questions:

- **Compatibility:** can this model load and answer inference?
- **Recommendation:** is this a good model for this machine?

A model can be compatible but slow, or fast on a different machine. Sovara keeps those results separate.

## Validation phases

```text
DETECTING_HARDWARE
ANALYZING_MODEL
ESTIMATING_RESOURCES
PRECHECK
LOADING_MODEL
WARMING_UP
RUNNING_INFERENCE
MEASURING_RESOURCES
STABILITY_TEST
COMPLETED
```

## Rules

- RAM and VRAM are separate memory pools; never add them together.
- Use the GGUF header when available for KV-cache sizing.
- Keep a safety margin for the runtime, workspace, and other applications.
- Prefer full CUDA offload when it fits.
- Partial offload must be labelled partial.
- CPU/RAM fallback must be visible.
- A failed load is not the same as an invalid model.
- A successful HTTP response is not proof of GPU acceleration.

## Result states

| State | Meaning |
|---|---|
| `ESTIMATED_COMPATIBLE` | Preflight says the model may load |
| `ESTIMATED_INCOMPATIBLE` | Preflight proves the model cannot fit |
| `LOAD_FAILED` | Runtime startup or model loading failed |
| `INFERENCE_FAILED` | Model loaded but inference failed |
| `VERIFIED` | Load, inference, and stability checks passed |
| `VERIFIED_WITH_LIMITATIONS` | Passed with a documented limitation |

## Evidence to record

- hardware fingerprint;
- runtime version and executable path;
- requested and actual backend;
- model format, size, and architecture;
- context length and GPU layers;
- readiness result;
- latency and tokens per second when measured;
- observed VRAM when measurable;
- exact failure category and stderr root cause.

## Test-only sandbox

Deterministic hardware profiles live in `apps/desktop/tests/hardware-sandbox/`. They do not probe the developer machine and do not spawn a real model server.
