'use strict';
// Hardware monitor ported from apps/desktop/src/main/services/hardwareProfile.ts
// Plain Node (CJS), zero dependencies. Windows-first, degrades gracefully elsewhere.
const os = require('node:os');
const fs = require('node:fs');
const { execSync, execFileSync } = require('node:child_process');

function classifyGpu(name, totalVramMB) {
  const gpuName = String(name ?? '').trim();
  const lower = gpuName.toLowerCase();
  const hasName = gpuName.length > 0;
  const hasVram = typeof totalVramMB === 'number' && Number.isFinite(totalVramMB) && totalVramMB >= 1024;
  const gpuDetected = hasName && hasVram;
  let gpuVendor = 'Unknown';
  if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('quadro') || lower.includes('tesla') || lower.includes('rtx')) gpuVendor = 'NVIDIA';
  else if (lower.includes('amd') || lower.includes('radeon') || lower.includes('advanced micro devices')) gpuVendor = 'AMD';
  else if (lower.includes('intel') || lower.includes('arc graphics')) gpuVendor = 'Intel';
  else if (lower.includes('apple')) gpuVendor = 'Apple';
  const gpuRuntime = gpuDetected && gpuVendor === 'NVIDIA' ? 'cuda' : 'cpu';
  return { gpuDetected, gpuAvailable: gpuRuntime === 'cuda', gpuVendor, gpuRuntime };
}

function tryStorage() {
  try {
    const s = fs.statfsSync(process.cwd());
    return {
      freeGB: Math.round((s.bavail * s.bsize) / (1024 ** 3) * 10) / 10,
      totalGB: Math.round((s.blocks * s.bsize) / (1024 ** 3) * 10) / 10,
    };
  } catch { return {}; }
}

function nvidiaSmiOutput(args) {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const candidates = [
    'nvidia-smi.exe',
    `${systemRoot}\\System32\\nvidia-smi.exe`,
    `${programFiles}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
  ];
  for (const command of candidates) {
    try {
      return String(execFileSync(command, args, { timeout: 4000, encoding: 'utf8', windowsHide: true })).trim();
    } catch { /* next candidate */ }
  }
  return null;
}

function tryNvidiaSmi() {
  try {
    const out = nvidiaSmiOutput(['--query-gpu=utilization.gpu,memory.total,memory.free,name', '--format=csv,noheader,nounits']);
    if (!out) return null;
    const line = out.split('\n').map((s) => s.trim()).filter(Boolean)[0];
    if (!line) return null;
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length >= 3) {
      const util = parseInt(parts[0], 10);
      const total = parseInt(parts[1], 10);
      const free = parseInt(parts[2], 10);
      const name = parts.slice(3).join(',').trim() || undefined;
      if (Number.isFinite(total) && total > 0) {
        return {
          gpuUtil: Number.isFinite(util) ? util : undefined,
          totalVramMB: total,
          freeVramMB: Number.isFinite(free) ? free : undefined,
          name,
        };
      }
    }
    return null;
  } catch {
    try {
      const out = nvidiaSmiOutput(['--query-gpu=memory.total,memory.free,name', '--format=csv,noheader,nounits']);
      if (!out) return null;
      const line = out.split('\n').map((s) => s.trim()).filter(Boolean)[0];
      if (!line) return null;
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length >= 2) {
        const total = parseInt(parts[0], 10);
        const free = parseInt(parts[1], 10);
        const name = parts.slice(2).join(',').trim() || undefined;
        if (Number.isFinite(total) && total > 0) {
          return { totalVramMB: total, freeVramMB: Number.isFinite(free) ? free : undefined, name };
        }
      }
      return null;
    } catch { return null; }
  }
}

function tryWmic() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('wmic path win32_VideoController get Name,AdapterRAM /format:list', { timeout: 4000, encoding: 'utf8', windowsHide: true });
    let name;
    let ram;
    for (const line of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (line.startsWith('Name=')) name = line.slice('Name='.length).trim();
      if (line.startsWith('AdapterRAM=')) {
        const v = parseInt(line.slice('AdapterRAM='.length).trim(), 10);
        if (Number.isFinite(v) && v > 0) ram = Math.round(v / (1024 * 1024));
      }
    }
    if (name || ram) return { name: name || undefined, totalVramMB: ram && ram > 0 ? ram : undefined };
    return null;
  } catch { return null; }
}

function tryPowerShell() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name, AdapterRAM | Format-List"', { timeout: 4000, encoding: 'utf8', windowsHide: true });
    const nameMatch = out.match(/Name\s*:\s*(.+)/);
    const ramMatch = out.match(/AdapterRAM\s*:\s*(\d+)/);
    const name = nameMatch ? nameMatch[1].trim() : undefined;
    const ram = ramMatch ? parseInt(ramMatch[1], 10) : NaN;
    if (name || Number.isFinite(ram)) {
      return { name, totalVramMB: Number.isFinite(ram) && ram > 0 ? Math.round(ram / (1024 * 1024)) : undefined };
    }
    return null;
  } catch { return null; }
}

function getHardwareProfile() {
  const totalRamMB = Math.round(os.totalmem() / (1024 * 1024));
  const freeRamMB = Math.round(os.freemem() / (1024 * 1024));
  let gpu = tryNvidiaSmi();
  if (!gpu || !gpu.totalVramMB) {
    const w = tryWmic();
    if (w) gpu = { ...(gpu ?? {}), ...w };
  }
  if (!gpu || !gpu.totalVramMB) {
    const p = tryPowerShell();
    if (p) gpu = { ...(gpu ?? {}), ...p };
  }
  let totalVramMB = gpu?.totalVramMB;
  const freeVramMB = gpu?.freeVramMB;
  const gpuUtil = typeof gpu?.gpuUtil === 'number' && Number.isFinite(gpu.gpuUtil) ? gpu.gpuUtil : undefined;
  if (totalVramMB !== undefined && totalVramMB < 0) totalVramMB = Math.abs(totalVramMB);
  const gpuClass = classifyGpu(gpu?.name, totalVramMB);
  const storage = tryStorage();
  const cpus = os.cpus();
  return {
    os: os.platform() === 'win32' ? 'Windows' : os.platform() === 'darwin' ? 'macOS' : os.platform(),
    osVersion: os.release(),
    arch: os.arch(),
    cpuModel: (cpus[0]?.model || 'Unknown CPU').trim(),
    cpuThreads: cpus.length || 1,
    totalRamMB,
    freeRamMB,
    totalVramMB: gpuClass.gpuDetected ? totalVramMB : undefined,
    freeVramMB: gpuClass.gpuDetected ? freeVramMB : undefined,
    gpuName: gpu?.name,
    gpuDetected: gpuClass.gpuDetected,
    gpuAvailable: gpuClass.gpuAvailable,
    gpuVendor: gpuClass.gpuVendor,
    gpuRuntime: gpuClass.gpuRuntime,
    gpuUtilization: gpuClass.gpuAvailable ? gpuUtil : undefined,
    storageFreeGB: storage.freeGB,
    storageTotalGB: storage.totalGB,
  };
}

function getCompatibilityMessage(hw) {
  if (hw.gpuAvailable && hw.totalVramMB) {
    return `VRAM: ${Math.round(hw.totalVramMB / 1024)}GB ${hw.gpuName ?? ''} · RAM: ${Math.round(hw.totalRamMB / 1024)}GB`;
  }
  if (hw.gpuDetected && hw.gpuName) {
    return `Detected ${hw.gpuName}, but the current runtime has no compatible GPU backend · CPU/RAM mode · ${Math.round(hw.totalRamMB / 1024)}GB RAM`;
  }
  return `CPU mode · RAM: ${Math.round(hw.totalRamMB / 1024)}GB · No dedicated GPU detected`;
}

module.exports = { classifyGpu, getHardwareProfile, getCompatibilityMessage };
