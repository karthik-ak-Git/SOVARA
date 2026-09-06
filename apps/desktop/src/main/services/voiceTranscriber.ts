/**
 * Voice transcription via local Whisper model (no API keys, no network).
 * Uses @huggingface/transformers with ONNX Runtime for inference.
 * Model is downloaded once and cached locally.
 */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Cache models in user data directory — downloaded once, reused forever.
env.cacheDir = path.join(app.getPath('userData'), 'models', 'whisper')

export interface TranscribeResult {
  text: string
}

// Singleton — model loads once and stays in memory.
let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null

async function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    // whisper-tiny: ~75MB download, fast on CPU, good enough for voice commands.
    transcriberPromise = pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny') as Promise<AutomaticSpeechRecognitionPipeline>
  }
  return transcriberPromise
}

export class VoiceTranscriber {
  async transcribe(audioBase64: string, format: string = 'webm'): Promise<TranscribeResult> {
    const tempDir = app.getPath('temp')
    const ext = format === 'webm' ? 'webm' : format === 'mp3' ? 'mp3' : 'wav'
    const tempFile = path.join(tempDir, `sovara_voice_${Date.now()}.${ext}`)

    try {
      const buffer = Buffer.from(audioBase64, 'base64')
      fs.writeFileSync(tempFile, buffer)

      const pipe = await getTranscriber()
      const result = await pipe(tempFile as unknown as string)

      // Result is { text: string } or { text: string }[]
      const text = Array.isArray(result) ? result[0]?.text ?? '' : result?.text ?? ''

      return { text: text.trim() }
    } finally {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
