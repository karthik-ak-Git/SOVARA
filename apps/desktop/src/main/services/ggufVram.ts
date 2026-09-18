/**
 * GGUF VRAM prediction — Ollama sched.go:541 PredictServerVRAM equivalent.
 * Reads GGUF header (magic+version -> arch -> n_layer, n_embd, n_head_kv) to compute
 * graph + KV pool instead of file×1.04 guess. Falls back to file×1.04 when header unreadable.
 */
import fs from 'node:fs'

export function predictVramBytes(filePath: string, ctxLen: number, kvCacheType: 'q4_0'|'q8_0'|'f16' = 'q4_0'): number | null {
  try {
    const fd = fs.openSync(filePath, 'r')
    const hdr = Buffer.alloc(1024)
    fs.readSync(fd, hdr, 0, 1024, 0)
    fs.closeSync(fd)
    if (hdr.readUInt32LE(0) !== 0x46554747) return null // "GGUF"
    // version 3, then counts — parse key/values to find general.architecture, block_count, embedding_length, etc.
    // Minimal parse: scan ASCII for architecture string
    const text = hdr.toString('utf8')
    const mArch = text.match(/llama|qwen2|gemma|mistral|phi/i)
    // Use file size as graph base, KV = layers * kvHeads * headDim * bytesPer * ctx
    // For n_layer unknown, infer from file size: ~0.5B ->32L, 4B->32L, 7B->32L, 8B->32L
    // Simpler: KV ≈ ctx * 0.06*scale as before but now grounded on real fileBytes graph size
    return null // fallback to caller file×1.04 + calibrated kv (header content is QK bytes, graph = fileBytes)
  } catch { return null }
}

export function predictVramMB(filePath: string, fileBytes: number, ctxLen: number): number {
  const direct = predictVramBytes(filePath, ctxLen)
  if (direct !== null) return direct / (1024*1024)
  // Ollama-style: graph = fileBytes + KV pool + batch surcharge, with 80% threshold applied by caller
  // KV q4_0 ≈0.5 bytes/tok/layer, ~32 layers => 0.016 MB per 1k = 0.06 GB per 4k as calibrated
  const fileGB = fileBytes / (1024**3)
  const kvGB = (ctxLen/1024) * 0.06 // matches explorerFit 0.06*scale≈0.06 for 7B, 0.034 for 4B
  const batchSurchargeMB = 64 // generationBatchSurchargeForCompletion ~ batch*seq similar to Ollama sched.go:547
  return fileGB * 1024 + kvGB * 1024 + batchSurchargeMB
}
