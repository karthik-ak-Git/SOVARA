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

function tryWmic(): { name?: string; totalVramMB?: number; gpuUtil?: number } | null {
  if (process.platform !== 'win32') return null
  try {
    // wmic returns AdapterRAM in bytes
    const out = execSync('wmic path win32_VideoController get Name,AdapterRAM /format:list', { timeout: 4000, encoding: 'utf8', windowsHide: true } as any)
    const lines = out.split('\n').map((s) => s.trim()).filter(Boolean)
    let name: string | undefined
    let ram: number | undefined
    for (const line of lines) {
      if (line.startsWith('Name=')) name = line.slice('Name='.length).trim()
      if (line.startsWith('AdapterRAM=')) {
        const v = parseInt(line.slice('AdapterRAM='.length).trim(), 10)
        if (Number.isFinite(v) && v > 0) ram = Math.round(v / (1024 * 1024))
      }
    }
    if (name || ram) return { name: name || undefined, totalVramMB: ram && ram > 0 ? ram : undefined }
    return null
  } catch { return null }
}

function tryPowerShell(): { name?: string; totalVramMB?: number; gpuUtil?: number } | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name, AdapterRAM | Format-List"', { timeout: 4000, encoding: 'utf8', windowsHide: true } as any)
    const nameMatch = out.match(/Name\s*:\s*(.+)/)
    const ramMatch = out.match(/AdapterRAM\s*:\s*(\d+)/)
    const name = nameMatch ? nameMatch[1].trim() : undefined
    const ram = ramMatch ? parseInt(ramMatch[1], 10) : NaN
    if (name || Number.isFinite(ram)) {
      return { name, totalVramMB: Number.isFinite(ram) && ram > 0 ? Math.round(ram / (1024 * 1024)) : undefined }
    }
    return null
  } catch { return null }
}

export function getHardwareProfile(): HardwareInfo {
  const totalRamMB = Math.round(os.totalmem() / (1024 * 1024))
  const freeRamMB = Math.round(os.freemem() / (1024 * 1024))

  // Try GPU detection in priority: nvidia-smi → wmic → powershell
  let gpu: { name?: string; totalVramMB?: number; freeVramMB?: number; gpuUtil?: number } | null = null
  gpu = tryNvidiaSmi()
  if (!gpu || !gpu.totalVramMB) {
    const w = tryWmic()
    if (w) gpu = { ...(gpu ?? {}), ...w } as typeof gpu
  }
  if (!gpu || !gpu.totalVramMB) {
    const p = tryPowerShell()
    if (p) gpu = { ...(gpu ?? {}), ...p } as typeof gpu
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
  return {
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
    if (process.platform === 'win32') {
      const out = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum"', { timeout: 3000, encoding: 'utf8', windowsHide: true } as any)
      const n = parseInt(String(out).match(/\d+/)?.[0] ?? '', 10)
      if (Number.isFinite(n) && n > 0) return n
    } else {
      const raw = execSync('lscpu 2>/dev/null | awk \'/^Core\\(s\\) per socket/{c=$4} /^Socket\\(s\\)/{s=$2} END{print c*s}\'', { timeout: 2000, encoding: 'utf8' } as any)
      const n = parseInt(String(raw).trim(), 10)
      if (Number.isFinite(n) && n > 0) return n
    }
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
