/**
 * Voice transcription via OpenAI Whisper API.
 * Accepts base64 audio data, sends to OpenAI for transcription.
 */
import OpenAI from 'openai'
import type { SettingsStore } from '../config/SettingsStore'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface TranscribeResult {
  text: string
}

export class VoiceTranscriber {
  private readonly settings: SettingsStore

  constructor(settings: SettingsStore) {
    this.settings = settings
  }

  async transcribe(audioBase64: string, format: string = 'webm'): Promise<TranscribeResult> {
    const apiKey = this.settings.getOpenAIKey()
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY or configure in Settings.')
    }

    const baseUrl = this.settings.getOpenAIBaseUrl()
    const client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    })

    // Write audio to temp file (Whisper API requires a file)
    const tempDir = app.getPath('temp')
    const tempFile = path.join(tempDir, `sovara_voice_${Date.now()}.${format}`)
    try {
      const buffer = Buffer.from(audioBase64, 'base64')
      fs.writeFileSync(tempFile, buffer)

      const file = new File([buffer], `audio.${format}`, {
        type: `audio/${format}`,
      })

      const response = await client.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: 'en',
      })

      return {
        text: response.text ?? '',
      }
    } finally {
      // Clean up temp file
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile)
        }
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
