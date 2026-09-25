import type { ExploreModel, HardwareInfo } from '../../src/shared/types/explore'

/** Small deterministic model for entry-level CPU-only laptop tests. */
export const sandboxSmallModel: ExploreModel = {
  id: 'sandbox/small-0.6b',
  name: 'Sandbox Small 0.6B',
  slug: 'sandbox/small-0.6b',
  author: 'sandbox',
  description: 'Deterministic hardware sandbox model',
  longDescription: 'Deterministic hardware sandbox model',
  downloads: 0,
  likes: 0,
  staffPick: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  parameters: '0.6B',
  architecture: 'qwen3',
  capabilities: ['chat'],
  files: [{
    format: 'GGUF',
    sizeGB: 0.8,
    sizeBytes: 0.8 * 1024 ** 3,
    downloadUrl: 'https://sandbox.invalid/small.gguf',
    rfilename: 'small.gguf',
    quantization: 'Q4_K_M',
    runnable: true,
  }],
  tags: [],
  iconType: 'hf',
}

/** Representative 7B Q4 model for laptop, desktop, and server fit tests. */
export const sandboxSevenBModel: ExploreModel = {
  id: 'sandbox/model-7b',
  name: 'Sandbox 7B Q4',
  slug: 'sandbox/model-7b',
  author: 'sandbox',
  description: 'Deterministic hardware sandbox model',
  longDescription: 'Deterministic hardware sandbox model',
  downloads: 0,
  likes: 0,
  staffPick: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  parameters: '7B',
  architecture: 'llama',
  capabilities: ['chat', 'coding'],
  files: [{
    format: 'GGUF',
    sizeGB: 4.5,
    sizeBytes: 4.5 * 1024 ** 3,
    downloadUrl: 'https://sandbox.invalid/model-7b.gguf',
    rfilename: 'model-7b.gguf',
    quantization: 'Q4_K_M',
    runnable: true,
  }],
  tags: [],
  iconType: 'hf',
}

export type SandboxExpectation = 'fullGPUOffload' | 'fitWithoutGPU'

export interface SandboxProfile {
  id: string
  description: string
  hardware: HardwareInfo
  model: ExploreModel
  expected: SandboxExpectation
}

const mb = (gib: number): number => Math.round(gib * 1024)

/**
 * Test-only hardware range. These values do not probe the developer machine.
 * They model the supported policy from entry laptops through server hardware.
 */
export const sandboxProfiles: SandboxProfile[] = [
  {
    id: 'entry-cpu-laptop',
    description: '8 GB laptop, no supported GPU',
    hardware: {
      totalRamMB: mb(8), freeRamMB: mb(6), gpuDetected: false, gpuAvailable: false,
      gpuRuntime: 'cpu', gpuVendor: 'Unknown',
    },
    model: sandboxSmallModel,
    expected: 'fitWithoutGPU',
  },
  {
    id: 'ryzen-nvidia-laptop',
    description: 'Ryzen CPU with NVIDIA GPU; CPU vendor must not force CPU mode',
    hardware: {
      totalRamMB: mb(16), freeRamMB: mb(11), totalVramMB: mb(8), freeVramMB: mb(7),
      gpuName: 'NVIDIA GeForce RTX 4060 Laptop GPU', gpuDetected: true, gpuAvailable: true,
      gpuRuntime: 'cuda', gpuVendor: 'NVIDIA',
    },
    model: sandboxSevenBModel,
    expected: 'fullGPUOffload',
  },
  {
    id: 'amd-gpu-laptop',
    description: 'AMD GPU without a packaged CUDA runtime',
    hardware: {
      totalRamMB: mb(16), freeRamMB: mb(10), totalVramMB: mb(8), freeVramMB: mb(7),
      gpuName: 'AMD Radeon RX 7800M', gpuDetected: true, gpuAvailable: false,
      gpuRuntime: 'cpu', gpuVendor: 'AMD',
    },
    model: sandboxSevenBModel,
    expected: 'fitWithoutGPU',
  },
  {
    id: 'intel-gpu-laptop',
    description: 'Intel GPU without a packaged CUDA runtime',
    hardware: {
      totalRamMB: mb(16), freeRamMB: mb(10), totalVramMB: mb(4), freeVramMB: mb(3),
      gpuName: 'Intel Arc Graphics', gpuDetected: true, gpuAvailable: false,
      gpuRuntime: 'cpu', gpuVendor: 'Intel',
    },
    model: sandboxSmallModel,
    expected: 'fitWithoutGPU',
  },
  {
    id: 'nvidia-workstation',
    description: 'NVIDIA desktop with 24 GB VRAM',
    hardware: {
      totalRamMB: mb(64), freeRamMB: mb(48), totalVramMB: mb(24), freeVramMB: mb(22),
      gpuName: 'NVIDIA GeForce RTX 4090', gpuDetected: true, gpuAvailable: true,
      gpuRuntime: 'cuda', gpuVendor: 'NVIDIA',
    },
    model: sandboxSevenBModel,
    expected: 'fullGPUOffload',
  },
  {
    id: 'cpu-only-server',
    description: 'CPU-only server with large RAM',
    hardware: {
      totalRamMB: mb(256), freeRamMB: mb(220), gpuDetected: false, gpuAvailable: false,
      gpuRuntime: 'cpu', gpuVendor: 'Unknown',
    },
    model: sandboxSevenBModel,
    expected: 'fitWithoutGPU',
  },
  {
    id: 'nvidia-server',
    description: 'NVIDIA server GPU with 80 GB VRAM',
    hardware: {
      totalRamMB: mb(256), freeRamMB: mb(220), totalVramMB: mb(80), freeVramMB: mb(76),
      gpuName: 'NVIDIA A100-SXM4-80GB', gpuDetected: true, gpuAvailable: true,
      gpuRuntime: 'cuda', gpuVendor: 'NVIDIA',
    },
    model: sandboxSevenBModel,
    expected: 'fullGPUOffload',
  },
]
