/**
 * Settings persistence — API keys and user preferences.
 * Backed by SovaraDb `app_meta` table (WAL, encrypted-at-rest optional future).
 */
import { SovaraDb } from '../storage/db'

export interface SovaraSettings {
  openaiApiKey: string | null
  openaiBaseUrl: string | null
}

const KEY_OPENAI_API_KEY = 'settings:openai_api_key'
const KEY_OPENAI_BASE_URL = 'settings:openai_base_url'

export class SettingsStore {
  private readonly db: SovaraDb

  constructor(baseDir?: string) {
    this.db = new SovaraDb(baseDir)
  }

  getOpenAIKey(): string | null {
    return this.db.getMeta(KEY_OPENAI_API_KEY) ?? process.env['OPENAI_API_KEY'] ?? null
  }

  setOpenAIKey(key: string | null): void {
    if (key) {
      this.db.setMeta(KEY_OPENAI_API_KEY, key)
    } else {
      // Delete by setting empty
      this.db.setMeta(KEY_OPENAI_API_KEY, '')
    }
  }

  getOpenAIBaseUrl(): string | null {
    return this.db.getMeta(KEY_OPENAI_BASE_URL) ?? null
  }

  setOpenAIBaseUrl(url: string | null): void {
    if (url) {
      this.db.setMeta(KEY_OPENAI_BASE_URL, url)
    } else {
      this.db.setMeta(KEY_OPENAI_BASE_URL, '')
    }
  }

  getAll(): SovaraSettings {
    return {
      openaiApiKey: this.getOpenAIKey(),
      openaiBaseUrl: this.getOpenAIBaseUrl(),
    }
  }

  close(): void {
    this.db.close()
  }
}
