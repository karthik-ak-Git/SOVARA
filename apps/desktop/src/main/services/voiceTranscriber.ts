/**
 * Voice transcription via local Whisper model (no API keys, no network).
 * Uses @huggingface/transformers with ONNX Runtime for inference.
 * Accepts raw Float32Array PCM from the renderer — no AudioContext needed in main process.
 */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { app } from 'electron'
import path from 'node:path'

// Cache models in user data directory — downloaded once, reused forever.
env.cacheDir = path.join(app.getPath('userData'), 'models', 'whisper')
// Disable remote model fetching after cache — fully offline.
env.allowLocalModels = true

export interface TranscribeResult {
  text: string
}

// Singleton — model loads once and stays in memory.
let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null

async function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-tiny',
      { dtype: 'fp32' }
    ) as Promise<AutomaticSpeechRecognitionPipeline>
  }
  return transcriberPromise
}

export class VoiceTranscriber {
  /**
   * Transcribe raw PCM audio data.
   * @param audioFloat32 - base64-encoded Float32Array of raw PCM samples (16kHz mono)
   * @param sampleRate - sample rate of the audio (default 16000)
   */
  async transcribeFromPCM(audioFloat32: string, sampleRate: number = 16000): Promise<TranscribeResult> {
    // Decode base64 → Float32Array
    const raw = Buffer.from(audioFloat32, 'base64')
    const float32 = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)

    const pipe = await getTranscriber()

    // Pass raw PCM Float32Array with sample rate — no AudioContext needed.
    const result = await pipe(float32, { sampling_rate: sampleRate })

    const text = Array.isArray(result) ? result[0]?.text ?? '' : result?.text ?? ''
    return { text: text.trim() }
  }
}
