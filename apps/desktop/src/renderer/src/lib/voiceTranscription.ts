/**
 * Voice transcription via @huggingface/transformers WASM whisper.
 * Runs entirely in the renderer process — no IPC, no separate server.
 * Model is downloaded on first use and cached by the browser.
 */

import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

let pipe: AutomaticSpeechRecognitionPipeline | null = null
let loading = false
let loadPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null

const MODEL_ID = 'onnx-community/whisper-base'

async function getPipe(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (pipe) return pipe
  if (loadPromise) return loadPromise

  loading = true
  loadPromise = (async () => {
    try {
      const p = await pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: 'fp32',
        device: 'wasm',
      } as Parameters<typeof pipeline>[2] & { dtype: string; device: string })
      pipe = p
      return p
    } finally {
      loading = false
    }
  })()

  return loadPromise
}

export interface TranscribeResult {
  text: string
  language: string
  duration: number
}

/**
 * Convert a Blob (from MediaRecorder) to Float32Array at 16kHz mono.
 * This is required by the whisper model.
 */
async function blobToFloat32Array(blob: Blob): Promise<{ audio: Float32Array; sampleRate: number }> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx = new OfflineAudioContext(1, 1, 16000)
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

  // Resample to 16kHz mono
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000)
  const source = offlineCtx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offlineCtx.destination)
  source.start(0)

  const rendered = await offlineCtx.startRendering()
  const channelData = rendered.getChannelData(0)

  return { audio: channelData, sampleRate: 16000 }
}

/**
 * Refine transcribed text — apply jargon mapping, capitalization, contractions.
 * Ported from ZukuriFlow's TextRefiner for accuracy.
 */
function refineText(text: string): string {
  if (!text.trim()) return text

  // Jargon mapping (case-sensitive)
  const jargonMap: [RegExp, string][] = [
    [/\bpython\b/gi, 'Python'],
    [/\btypescript\b/gi, 'TypeScript'],
    [/\bjavascript\b/gi, 'JavaScript'],
    [/\breact\b/gi, 'React'],
    [/\bnextjs\b/gi, 'Next.js'],
    [/\bnext\.?js\b/gi, 'Next.js'],
    [/\bnode\.?js\b/gi, 'Node.js'],
    [/\belectron\b/gi, 'Electron'],
    [/\blanggraph\b/gi, 'LangGraph'],
    [/\bfastapi\b/gi, 'FastAPI'],
    [/\bdjango\b/gi, 'Django'],
    [/\bflask\b/gi, 'Flask'],
    [/\bgraphql\b/gi, 'GraphQL'],
    [/\bpostgresql\b/gi, 'PostgreSQL'],
    [/\bpostgres\b/gi, 'PostgreSQL'],
    [/\bsqlite\b/gi, 'SQLite'],
    [/\bmysql\b/gi, 'MySQL'],
    [/\bmongodb\b/gi, 'MongoDB'],
    [/\bredis\b/gi, 'Redis'],
    [/\bdocker\b/gi, 'Docker'],
    [/\bkubernetes\b/gi, 'Kubernetes'],
    [/\bk8s\b/gi, 'Kubernetes'],
    [/\bterraform\b/gi, 'Terraform'],
    [/\baws\b/gi, 'AWS'],
    [/\bgcp\b/gi, 'GCP'],
    [/\bazure\b/gi, 'Azure'],
    [/\bllm\b/gi, 'LLM'],
    [/\brag\b/gi, 'RAG'],
    [/\bapi\b/gi, 'API'],
    [/\bcli\b/gi, 'CLI'],
    [/\bide\b/gi, 'IDE'],
    [/\bui\b/gi, 'UI'],
    [/\bux\b/gi, 'UX'],
    [/\bci\b/gi, 'CI'],
    [/\bcd\b/gi, 'CD'],
    [/\bssh\b/gi, 'SSH'],
    [/\bhttp\b/gi, 'HTTP'],
    [/\bhttps\b/gi, 'HTTPS'],
    [/\bjson\b/gi, 'JSON'],
    [/\byaml\b/gi, 'YAML'],
    [/\bxml\b/gi, 'XML'],
    [/\bhtml\b/gi, 'HTML'],
    [/\bcss\b/gi, 'CSS'],
    [/\bdom\b/gi, 'DOM'],
    [/\brest\b/gi, 'REST'],
    [/\bjwt\b/gi, 'JWT'],
    [/\boauth\b/gi, 'OAuth'],
    [/\burl\b/gi, 'URL'],
    [/\bgpu\b/gi, 'GPU'],
    [/\bcpu\b/gi, 'CPU'],
    [/\bram\b/gi, 'RAM'],
    [/\bssd\b/gi, 'SSD'],
    [/\bgit\b/gi, 'Git'],
    [/\bgithub\b/gi, 'GitHub'],
    [/\bvscode\b/gi, 'VS Code'],
    [/\bwhisper\b/gi, 'Whisper'],
    [/\bsovara\b/gi, 'SOVARA'],
    [/\bsde\b/gi, 'SDE'],
  ]

  // Apply jargon
  for (const [pattern, replacement] of jargonMap) {
    text = text.replace(pattern, replacement)
  }

  // Spacing fixes
  text = text.replace(/  +/g, ' ')
  text = text.replace(/\s+([.,!?;:])/g, '$1')
  text = text.replace(/([.,!?;:])(\w)/g, '$1 $2')

  // Sentence capitalization
  text = text.replace(/(^|[.!?]\s+)(\w)/g, (m, sep, ch) => sep + ch.toUpperCase())

  // Ensure trailing punctuation
  if (text && !/[.!?]$/.test(text)) {
    text += '.'
  }

  // Contraction fixes
  const contractions: [RegExp, string][] = [
    [/\bdont\b/gi, "don't"],
    [/\bdoesnt\b/gi, "doesn't"],
    [/\bdidnt\b/gi, "didn't"],
    [/\bcant\b/gi, "can't"],
    [/\bwont\b/gi, "won't"],
    [/\bwouldnt\b/gi, "wouldn't"],
    [/\bcouldnt\b/gi, "couldn't"],
    [/\bshouldnt\b/gi, "shouldn't"],
    [/\bhasnt\b/gi, "hasn't"],
    [/\bhavent\b/gi, "haven't"],
    [/\bisnt\b/gi, "isn't"],
    [/\barent\b/gi, "aren't"],
    [/\bwasnt\b/gi, "wasn't"],
    [/\bwerent\b/gi, "weren't"],
    [/\bim\b/gi, "I'm"],
    [/\bive\b/gi, "I've"],
  ]

  for (const [pattern, replacement] of contractions) {
    text = text.replace(pattern, replacement)
  }

  return text
}

/**
 * Transcribe audio from a Blob using WASM whisper.
 * The blob should come from MediaRecorder (webm/opus or similar).
 */
export async function transcribeAudioBlob(blob: Blob): Promise<TranscribeResult> {
  const t0 = performance.now()

  // Ensure pipeline is loaded
  const whisper = await getPipe()

  // Convert blob to Float32Array at 16kHz
  const { audio } = await blobToFloat32Array(blob)

  // Run whisper inference
  const result = await whisper(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false,
  })

  const elapsed = (performance.now() - t0) / 1000

  // Extract text from result
  const raw = typeof result === 'string'
    ? result
    : Array.isArray(result)
      ? result.map((r: { text?: string }) => r.text ?? '').join(' ')
      : (result as { text?: string }).text ?? ''

  // Refine text (jargon, capitalization, contractions)
  const text = refineText(raw)

  console.log(`[voice] Transcribed in ${elapsed.toFixed(2)}s: "${text.slice(0, 60)}..."`)

  return {
    text,
    language: 'auto',
    duration: audio.length / 16000,
  }
}

/**
 * Check if whisper model is currently loading.
 */
export function isWhisperLoading(): boolean {
  return loading
}
