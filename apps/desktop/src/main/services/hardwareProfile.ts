import os from 'node:os'
import fs from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import type { HardwareInfo } from '@shared/types/explore'

type GpuVendor = NonNullable<HardwareInfo['gpuVendor']>
type GpuRuntime = NonNullable<HardwareInfo['gpuRuntime']>

export interface GpuClassification {
  gpuDetected: boolean
  gpuAvailable: boolean
  gpuVendor: GpuVendor
  gpuRuntime: GpuRuntime
}

/**
 * Classify a detected adapter without pretending that every GPU can use the
 * current runtime. Sovara's owned Windows build is CUDA + CPU today; AMD and
 * Intel adapters therefore remain detected but route to CPU unless a matching
 * runtime is added later.
 */
export function classifyGpu(name: string | undefined, totalVramMB: number | undefined): GpuClassification {
  const gpuName = String(name ?? '').trim()
  const lower = gpuName.toLowerCase()
  const hasName = gpuName.length > 0
  const hasVram = typeof totalVramMB === 'number' && Number.isFinite(totalVramMB) && totalVramMB >= 1024
  const gpuDetected = hasName && hasVram

  let gpuVendor: GpuVendor = 'Unknown'
  if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('quadro') || lower.includes('tesla') || lower.includes('rtx')) gpuVendor = 'NVIDIA'
  else if (lower.includes('amd') || lower.includes('radeon') || lower.includes('advanced micro devices')) gpuVendor = 'AMD'
  else if (lower.includes('intel') || lower.includes('arc graphics')) gpuVendor = 'Intel'
  else if (lower.includes('apple')) gpuVendor = 'Apple'

  const gpuRuntime: GpuRuntime = gpuDetected && gpuVendor === 'NVIDIA' ? 'cuda' : 'cpu'
  return {
    gpuDetected,
    gpuAvailable: gpuRuntime === 'cuda',
    gpuVendor,
    gpuRuntime,
  }
}

function tryStorage(): { freeGB?: number; totalGB?: number } {
  try {
    const s = fs.statfsSync(process.cwd())
    const freeGB = Math.round((s.bavail * s.bsize) / (1024 ** 3) * 10) / 10
    const totalGB = Math.round((s.blocks * s.bsize) / (1024 ** 3) * 10) / 10
    return { freeGB, totalGB }
  } catch {
    return {}
  }
}

function nvidiaSmiOutput(args: string[]): string | null {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const candidates = [
    'nvidia-smi.exe',
    `${systemRoot}\\System32\\nvidia-smi.exe`,
    `${programFiles}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
  ]
  for (const command of candidates) {
    try {
      return String(execFileSync(command, args, { timeout: 4000, encoding: 'utf8', windowsHide: true } as any)).trim()
    } catch {
      // Try the next known Windows install location.
    }
  }
  return null
}

function tryNvidiaSmi(): { name?: string; totalVramMB?: number; freeVramMB?: number; gpuUtil?: number } | null {
  try {
    // Include utilization.gpu for live load bar — "42, 8192, 6144, NVIDIA GeForce RTX 4080"
    const out = nvidiaSmiOutput(['--query-gpu=utilization.gpu,memory.total,memory.free,name', '--format=csv,noheader,nounits'])
    if (!out) return null
    const line = out.split('\n').map((s) => s.trim()).filter(Boolean)[0]
    if (!line) return null
    const parts = line.split(',').map((s) => s.trim())
    if (parts.length >= 3) {
      const util = parseInt(parts[0], 10)
      const total = parseInt(parts[1], 10)
      const free = parseInt(parts[2], 10)
      const name = parts.slice(3).join(',').trim() || undefined
      if (Number.isFinite(total) && total > 0) {
        return { gpuUtil: Number.isFinite(util) ? util : undefined, totalVramMB: total, freeVramMB: Number.isFinite(free) ? free : undefined, name }
      }
    }
    // Fallback: older driver without utilization column still returns 3 cols above; keep retry without util for compat
    return null
  } catch {
    // Compat fallback without util column (very old drivers)
    try {
      const out = nvidiaSmiOutput(['--query-gpu=memory.total,memory.free,name', '--format=csv,noheader,nounits'])
      if (!out) return null
      const line = out.split('\n').map((s) => s.trim()).filter(Boolean)[0]
      if (!line) return null
      const parts = line.split(',').map((s) => s.trim())
      if (parts.length >= 2) {
        const total = parseInt(parts[0], 10)
        const free = parseInt(parts[1], 10)
        const name = parts.slice(2).join(',').trim() || undefined
        if (Number.isFinite(total) && total > 0) return { totalVramMB: total, freeVramMB: Number.isFinite(free) ? free : undefined, name }
      }
      return null
    } catch { return null }
  }
}

function tryWindowsRegistryGpu(): { name?: string } | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}', '/s', '/v', 'DriverDesc'], {
      timeout: 1500,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const matches = Array.from(out.matchAll(/DriverDesc\s+REG_SZ\s+(.+)/gi))
    for (const m of matches) {
      const name = m[1]?.trim()
      if (name && !name.toLowerCase().includes('basic render') && !name.toLowerCase().includes('virtual')) {
        return { name }
      }
    }
  } catch { /* silent fallback */ }
  return null
}

let cachedHwProfile: (HardwareInfo & { gpuUtilization?: number }) | null = null
let cachedHwTime = 0
const HW_CACHE_TTL = 15_000

export function getHardwareProfile(): HardwareInfo {
  const now = Date.now()
  if (cachedHwProfile && (now - cachedHwTime) < HW_CACHE_TTL) {
    return cachedHwProfile
  }

  const totalRamMB = Math.round(os.totalmem() / (1024 * 1024))
  const freeRamMB = Math.round(os.freemem() / (1024 * 1024))

  // Try GPU detection in priority: nvidia-smi → registry (zero wmic / powershell blocking)
  let gpu: { name?: string; totalVramMB?: number; freeVramMB?: number; gpuUtil?: number } | null = null
  gpu = tryNvidiaSmi()
  if (!gpu || !gpu.totalVramMB) {
    const regGpu = tryWindowsRegistryGpu()
    if (regGpu) gpu = { ...(gpu ?? {}), ...regGpu } as typeof gpu
  }

  let totalVramMB = gpu?.totalVramMB
  let freeVramMB = gpu?.freeVramMB
  const gpuUtil = typeof gpu?.gpuUtil === 'number' && Number.isFinite(gpu.gpuUtil) ? gpu.gpuUtil : undefined
  // WMIC can report AdapterRAM as signed 32-bit; large VRAM wraps negative — clamp without fabricating free
  if (totalVramMB !== undefined && totalVramMB < 0) totalVramMB = Math.abs(totalVramMB)
  // Do NOT synthesize freeVramMB when nvidia-smi unavailable: keep undefined so callers show estimation-only warning
  const gpuClass = classifyGpu(gpu?.name, totalVramMB)
  const gpuDetected = gpuClass.gpuDetected
  const gpuAvailable = gpuClass.gpuAvailable

  const storage = tryStorage()
  const res = {
    totalRamMB,
    freeRamMB,
    totalVramMB: gpuDetected ? totalVramMB : undefined,
    freeVramMB: gpuDetected ? freeVramMB : undefined,
    gpuName: gpu?.name,
    gpuDetected,
    gpuAvailable,
    gpuVendor: gpuClass.gpuVendor,
    gpuRuntime: gpuClass.gpuRuntime,
    gpuUtilization: gpuAvailable ? gpuUtil : undefined,
    storageFreeGB: storage.freeGB,
    storageTotalGB: storage.totalGB,
  } as HardwareInfo & { gpuUtilization?: number }

  cachedHwProfile = res
  cachedHwTime = Date.now()
  return res
}

export function getVramAwareCompatibilityMessage(hw: HardwareInfo): string {
  if (hw.gpuAvailable && hw.totalVramMB) {
    return `VRAM: ${Math.round(hw.totalVramMB / 1024)}GB ${hw.gpuName ?? ''} · RAM: ${Math.round(hw.totalRamMB / 1024)}GB`
  }
  if (hw.gpuDetected && hw.gpuName) {
    return `Detected ${hw.gpuName}, but the current runtime has no compatible GPU backend · CPU/RAM mode · ${Math.round(hw.totalRamMB / 1024)}GB RAM`
  }
  return `CPU mode · RAM: ${Math.round(hw.totalRamMB / 1024)}GB · No dedicated GPU detected`
}

// ── Full profile per MODEL_HARDWARE_VALIDATION 3-4 ──────────────────
import type { HardwareProfileFull } from '@shared/types/validation'

function detectPhysicalCores(): number | null {
  try {
    if (typeof (os as unknown as { availableParallelism?: () => number }).availableParallelism === 'function') {
      const p = (os as unknown as { availableParallelism: () => number }).availableParallelism()
      if (typeof p === 'number' && p > 0) return Math.max(1, Math.round(p / 2))
    }
    const threads = os.cpus().length || 8
    return Math.max(1, Math.round(threads / 2))
  } catch { /* fallback */ }
  return null
}

function detectCpu(): HardwareProfileFull['cpu'] {
  const cpus = os.cpus()
  const model = cpus[0]?.model?.trim() || 'Unknown CPU'
  const threads = cpus.length || 1
  const physical = detectPhysicalCores()
  const cores = physical ?? Math.max(1, Math.round(threads / 2))
  return { name: model, cores, threads }
}

function detectBackend(): HardwareProfileFull['backend'] {
  // Real backend detection is runtime-specific; report the primary adapter family.
  // GPU availability already covers CUDA/Metal; this field is for ValidationResult persistence.
  const hw = getHardwareProfile()
  if (hw.gpuAvailable) return { name: 'CUDA', available: true }
  return { name: 'CPU', available: true }
}

export function getFullHardwareProfile(): HardwareProfileFull {
  const hw = getHardwareProfile()
  const cpu = detectCpu()
  const totalMB = hw.totalRamMB
  const freeMB = hw.freeRamMB
  const usedMB = Math.max(0, totalMB - freeMB)
  const osName = os.platform() === 'win32' ? 'Windows' : os.platform() === 'darwin' ? 'macOS' : os.platform()
  return {
    os: osName,
    osVersion: os.release(),
    architecture: os.arch(),
    cpu,
    memory: { ram_total_mb: totalMB, ram_available_mb: freeMB, ram_used_mb: usedMB },
    gpu: {
      name: hw.gpuName,
      vendor: hw.gpuName?.toLowerCase().includes('nvidia') ? 'NVIDIA' : hw.gpuName ? 'Unknown' : undefined,
      vram_total_mb: hw.totalVramMB,
      vram_available_mb: hw.freeVramMB,
    },
    backend: detectBackend(),
  }
}

export function hardwareFingerprint(hw: HardwareProfileFull): string {
  // Used for ValidationStore cache invalidation (docs 25)
  return [hw.cpu.name, hw.gpu.name ?? 'no-gpu', String(hw.memory.ram_total_mb), String(hw.gpu.vram_total_mb ?? 0), hw.backend.name, hw.architecture, hw.os].join('|')
}
