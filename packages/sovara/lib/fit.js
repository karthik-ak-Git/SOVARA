'use strict';
// Model-fit estimator ported from apps/desktop/src/main/services/hardwareCheck.ts
// Isolated-pool rule: NEVER sum VRAM + RAM. GPU path checks VRAM only,
// CPU path checks RAM only.
const DEFAULT_N_CTX = 4096;

function estimateKvCacheGB(nCtx, paramsB, fileGB) {
  if (!nCtx || nCtx <= 0) return 0;
  let p = paramsB;
  if (!(p > 0)) {
    if (fileGB && fileGB > 0) p = Math.max(0.05, fileGB / 0.6);
    else p = 7;
  }
  if (fileGB && fileGB > 0 && fileGB < 1.0 && p > 3) p = Math.max(0.05, fileGB / 0.6);
  const scale = Math.min(2.2, Math.max(0.05, p / 7));
  return (nCtx / 1024) * (0.42 * scale);
}

function parseParamsB(params) {
  if (!params) return undefined;
  const m = String(params).match(/([\d.]+)\s*B\b/i);
  if (m) return parseFloat(m[1]);
  const mM = String(params).match(/([\d.]+)\s*M\b/i);
  if (mM) return parseFloat(mM[1]) / 1000;
  return undefined;
}

function estimateFit({ sizeGB, params = '7B', nCtx = DEFAULT_N_CTX, hw }) {
  const paramsB = parseParamsB(params);
  const kv = estimateKvCacheGB(nCtx, paramsB, sizeGB);
  const need = sizeGB > 0 ? sizeGB * 1.12 + kv : 0;
  const totalRamGB = hw.totalRamMB / 1024;
  const freeRamGB = hw.freeRamMB / 1024;
  const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined;
  const freeVramGB = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined;
  const cuda = hw.gpuAvailable && (hw.gpuRuntime === 'cuda' || hw.gpuRuntime === undefined);
  if (cuda && totalVramGB) {
    if (need > totalVramGB) {
      if (need <= totalRamGB) {
        return { fits: true, needGB: need, kvGB: kv, where: 'cpu-partial', severity: 'tight', message: `Too large for VRAM (~${need.toFixed(1)} GB > ${totalVramGB.toFixed(1)} GB). Fits in RAM (~${totalRamGB.toFixed(0)} GB) — CPU or partial offload (slower).` };
      }
      return { fits: false, needGB: need, kvGB: kv, where: 'none', severity: 'too-large', message: `Requires ~${need.toFixed(1)} GB — too large for GPU (${totalVramGB.toFixed(1)} GB) and RAM (${totalRamGB.toFixed(0)} GB).` };
    }
    if (freeVramGB !== undefined && need > freeVramGB * 0.92) {
      return { fits: true, needGB: need, kvGB: kv, where: 'vram', severity: 'tight', message: `Fits VRAM but tight (~${need.toFixed(1)} GB / ${totalVramGB.toFixed(1)} GB, free ${freeVramGB.toFixed(1)} GB). Close other GPU apps.` };
    }
    if (freeVramGB === undefined && need > totalVramGB * 0.88) {
      return { fits: true, needGB: need, kvGB: kv, where: 'vram', severity: 'tight', message: `Fits VRAM total (${totalVramGB.toFixed(1)} GB) but free VRAM unknown — estimate may be optimistic. Requires ~${need.toFixed(1)} GB.` };
    }
    return { fits: true, needGB: need, kvGB: kv, where: 'vram', severity: 'good', message: `Fits in VRAM (~${need.toFixed(1)} GB / ${totalVramGB.toFixed(1)} GB). Optimal for fast inference.` };
  }
  if (need > totalRamGB) {
    return { fits: false, needGB: need, kvGB: kv, where: 'none', severity: 'too-large', message: `Likely too large for CPU. Needs ~${need.toFixed(1)} GB but system has ${totalRamGB.toFixed(0)} GB RAM.` };
  }
  if (need > freeRamGB * 0.9) {
    return { fits: false, needGB: need, kvGB: kv, where: 'cpu', severity: 'tight', message: `Might be tight on CPU: needs ~${need.toFixed(1)} GB, only ${freeRamGB.toFixed(1)} GB free. Close apps or pick a smaller quant.` };
  }
  return { fits: true, needGB: need, kvGB: kv, where: 'cpu', severity: 'good', message: `Will run on CPU: ~${need.toFixed(1)} GB / ${totalRamGB.toFixed(0)} GB RAM. Expect slower inference.` };
}

module.exports = { DEFAULT_N_CTX, estimateKvCacheGB, parseParamsB, estimateFit };
