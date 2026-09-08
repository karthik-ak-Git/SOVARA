import os from 'node:os'
import { execSync } from 'node:child_process'
import type { HardwareInfo } from '@shared/types/explore'

function tryNvidiaSmi(): { name?: string; totalVramMB?: number; freeVramMB?: number } | null {
  try {
    // nvidia-smi outputs: "8192, NVIDIA GeForce RTX 4080"
    const out = execSync('nvidia-smi --query-gpu=memory.total,memory.free,name --format=csv,noheader,nounits', { timeout: 4000, encoding: 'utf8', windowsHide: true } as any)
    const line = out.split('\n').map((s) => s.trim()).filter(Boolean)[0]
    if (!line) return null
    // CSV: "8192, 6144, NVIDIA GeForce RTX 4080"
    const parts = line.split(',').map((s) => s.trim())
    if (parts.length >= 2) {
      const total = parseInt(parts[0], 10)
      const free = parseInt(parts[1], 10)
      const name = parts.slice(2).join(',').trim() || undefined
      if (Number.isFinite(total) && total > 0) {
        return { totalVramMB: total, freeVramMB: Number.isFinite(free) ? free : undefined, name }
      }
    }
    return null
  } catch { return null }
}

function tryWmic(): { name?: string; totalVramMB?: number } | null {
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

function tryPowerShell(): { name?: string; totalVramMB?: number } | null {
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
  let gpu: { name?: string; totalVramMB?: number; freeVramMB?: number } | null = null
  gpu = tryNvidiaSmi()
  if (!gpu || !gpu.totalVramMB) {
    const w = tryWmic()
    if (w) gpu = { ...gpu, ...w }
  }
  if (!gpu || !gpu.totalVramMB) {
    const p = tryPowerShell()
    if (p) gpu = { ...gpu, ...p }
  }

  let totalVramMB = gpu?.totalVramMB
  let freeVramMB = gpu?.freeVramMB
  // WMIC can report AdapterRAM as signed 32-bit; large VRAM wraps negative — clamp without fabricating free
  if (totalVramMB !== undefined && totalVramMB < 0) totalVramMB = Math.abs(totalVramMB)
  // Do NOT synthesize freeVramMB when nvidia-smi unavailable: keep undefined so callers show estimation-only warning
  // Filter integrated GPUs with tiny VRAM (< 1GB) — treat as CPU-only
  const isDedicated = totalVramMB !== undefined && totalVramMB >= 1024
  const gpuAvailable = Boolean(isDedicated && gpu?.name)

  return {
    totalRamMB,
    freeRamMB,
    totalVramMB: isDedicated ? totalVramMB : undefined,
    freeVramMB: isDedicated ? freeVramMB : undefined,
    gpuName: gpu?.name,
    gpuAvailable,
  }
}

export function getVramAwareCompatibilityMessage(hw: HardwareInfo): string {
  if (hw.gpuAvailable && hw.totalVramMB) {
    return `VRAM: ${Math.round(hw.totalVramMB / 1024)}GB ${hw.gpuName ?? ''} · RAM: ${Math.round(hw.totalRamMB / 1024)}GB`
  }
  return `CPU mode · RAM: ${Math.round(hw.totalRamMB / 1024)}GB · No dedicated GPU detected`
}

// ── Full profile per MODEL_HARDWARE_VALIDATION 3-4 ──────────────────
import type { HardwareProfileFull } from '@shared/types/validation'

function detectCpu(): HardwareProfileFull['cpu'] {
  const cpus = os.cpus()
  const model = cpus[0]?.model?.trim() || 'Unknown CPU'
  const threads = cpus.length || 1
  // physical cores unknown without wmic; use threads as fallback
  const cores = threads
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
