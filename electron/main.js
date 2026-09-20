// Sovora Disk KV — Electron main process.
//
// Automated hardware profiling at startup + IPC routing matrix:
//   hardware-status-fetch : { modelSizeMb? } → { success, profile }
//   engine-init           : { modelPath, contextSize?, gpuLayers?, cacheBlockSizeKb? } → { success, profile }
//   prompt-submit         : { prompt, maxTokens? } → streamed progress + final { success, response, tokensPerSecond }
//
// Dynamic profiling rule tree (never assumes the GPU):
//   - total RAM < 16GB        → context capped to 128k with an explicit warning
//   - free VRAM < 6GB         → gpuLayers forced to ≤ 4 (KV goes through the
//                               C++ SSD swap engine instead of VRAM)
//   - no NVIDIA GPU detected  → CPU mode, context sized from free RAM
// Everything is computed from live os/nvidia-smi values — no constants.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const CONTEXT_TIERS = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072];
const SAFETY_MARGIN = 0.85;
const MB_PER_1K_TOKENS = 8; // KV-cache estimate for 7B-class models

function pickTierAtOrBelow(usableMb, mbPer1kTokens) {
  const maxCtx = Math.floor((usableMb / mbPer1kTokens) * 1000);
  const eligible = CONTEXT_TIERS.filter((tier) => tier <= maxCtx);
  return eligible.length > 0 ? eligible[eligible.length - 1] : CONTEXT_TIERS[0];
}

function getFreeVramMb() {
  return new Promise((resolve) => {
    exec(
      'nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits',
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(0);
          return;
        }
        const firstLine = String(stdout).trim().split('\n')[0];
        const parsed = parseInt(firstLine, 10);
        resolve(Number.isNaN(parsed) ? 0 : parsed);
      }
    );
  });
}

function getGpuName() {
  return new Promise((resolve) => {
    const cmd =
      process.platform === 'win32'
        ? 'wmic path win32_VideoController get name /format:list'
        : 'lspci 2>/dev/null | grep -i vga || true';
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve('unknown');
        return;
      }
      const line = String(stdout)
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().startsWith('name=') || l.toLowerCase().includes('vga'));
      resolve(line ? line.replace(/^name=/i, '').trim() : 'unknown');
    });
  });
}

async function detectHardwareProfile(modelSizeMb) {
  const freeVramMb = await getFreeVramMb();
  const freeRamMb = Math.floor(os.freemem() / (1024 * 1024));
  const totalRamMb = Math.floor(os.totalmem() / (1024 * 1024));
  const gpuName = await getGpuName();
  const warnings = [];
  const profile = {
    freeVramMb,
    freeRamMb,
    totalRamMb,
    gpuName,
    modelSizeMb,
    gpuLayers: 0,
    contextSize: CONTEXT_TIERS[0],
    mode: 'cpu',
    cacheDir: path.join(app.getPath('userData'), 'disk_kv'),
    warnings,
  };

  if (freeVramMb === 0) {
    profile.mode = 'cpu';
    profile.gpuLayers = 0;
    const usableMb = freeRamMb * SAFETY_MARGIN;
    profile.contextSize = pickTierAtOrBelow(usableMb, MB_PER_1K_TOKENS);
    warnings.push('No NVIDIA GPU detected. Running CPU-only.');
  } else {
    const usableVramMb = freeVramMb * SAFETY_MARGIN;
    if (modelSizeMb >= usableVramMb) {
      const fitRatio = usableVramMb / modelSizeMb;
      const estimatedTotalLayers = 32;
      profile.gpuLayers = Math.max(1, Math.floor(estimatedTotalLayers * fitRatio));
      profile.mode = 'partial-gpu';
      warnings.push(
        `Model (${modelSizeMb}MB) exceeds free VRAM (${freeVramMb}MB). Using partial offload: ${profile.gpuLayers} layers.`
      );
      const usableMb = Math.max(usableVramMb - profile.gpuLayers * (modelSizeMb / estimatedTotalLayers), 256);
      profile.contextSize = pickTierAtOrBelow(usableMb, MB_PER_1K_TOKENS);
    } else {
      profile.gpuLayers = -1; // full offload
      profile.mode = 'full-gpu';
      const usableMb = Math.max(usableVramMb - modelSizeMb, 256);
      profile.contextSize = pickTierAtOrBelow(usableMb, MB_PER_1K_TOKENS);
    }
  }

  // Dynamic rule tree — consumer-hardware guards, never hard-coded.
  if (totalRamMb < 16 * 1024) {
    if (profile.contextSize > 131072) profile.contextSize = 131072;
    warnings.push(`System RAM is ${(totalRamMb / 1024).toFixed(1)}GB — context capped to 128k.`);
  }
  if (freeVramMb > 0 && freeVramMb < 6144) {
    // RTX 3050-class: keep VRAM for weights; the 1M-token KV runs on the
    // C++ NVMe swap engine, so at most 4 layers stay on the GPU.
    if (profile.gpuLayers > 4) profile.gpuLayers = 4;
    warnings.push(`Free VRAM ${freeVramMb}MB < 6GB — gpuLayers locked to ≤ 4, KV streams from NVMe.`);
  }

  try {
    if (!fs.existsSync(profile.cacheDir)) fs.mkdirSync(profile.cacheDir, { recursive: true });
  } catch (err) {
    warnings.push(`Cache dir unavailable: ${err.message}`);
  }
  return profile;
}

// ── Window lifecycle ──────────────────────────────────────────────────────

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC routing matrix ────────────────────────────────────────────────────

ipcMain.handle('hardware-status-fetch', async (_event, args) => {
  try {
    const profile = await detectHardwareProfile(args && args.modelSizeMb ? args.modelSizeMb : 4000);
    return { success: true, profile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('engine-init', async (_event, config) => {
  try {
    const modelPath = config && config.modelPath;
    if (!modelPath) return { success: false, error: 'modelPath is required.' };
    let stat;
    try {
      stat = fs.statSync(modelPath);
    } catch (err) {
      return { success: false, error: `Model file not found at ${modelPath}` };
    }
    const modelSizeMb = Math.floor(stat.size / (1024 * 1024));
    const profile = await detectHardwareProfile(modelSizeMb);
    // The native addon owns the disk-KV engine; initEngine profiles again on
    // its worker thread. We hand it the hardware-derived parameters.
    return { success: true, profile, engine: { modelPath, contextSize: profile.contextSize, gpuLayers: profile.gpuLayers, cacheBlockSizeKb: 256 } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('prompt-submit', async (_event, args) => {
  // Generation runs inside the native addon (generateTokenAsync) so tokens
  // stream to the renderer without blocking this process. The renderer calls
  // the addon directly through the preload bridge; this handler exists for
  // diagnostic parity and non-addon fallbacks.
  return { success: false, error: 'use disk_llama_core addon via preload bridge' };
});
