/**
 * Voice transcription via Web Speech API (built into Chromium/Electron).
 * Zero external dependencies — uses the OS speech recognition engine.
 * Runs entirely in the renderer process — no IPC, no CDN, no WASM.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type SpeechRecognitionInstance = any
type SpeechRecognitionEventResult = any

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
}

export interface TranscribeResult {
  text: string
  language: string
  duration: number
}

/**
 * Check if Web Speech API is available.
 */
export function isSpeechRecognitionAvailable(): boolean {
  return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
}

/**
 * Refine transcribed text — apply jargon mapping, capitalization, contractions.
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
 * Transcribe speech using the Web Speech API.
 * Returns a promise that resolves when the user stops speaking (or stops the mic).
 */
export function startSpeechRecognition(): {
  promise: Promise<TranscribeResult>
  stop: () => void
} {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) {
    throw new Error('SpeechRecognition API not available')
  }

  const recognition: SpeechRecognitionInstance = new Ctor()
  recognition.continuous = true
  recognition.interimResults = false
  recognition.lang = 'en-US'
  recognition.maxAlternatives = 1

  const t0 = performance.now()

  const promise = new Promise<TranscribeResult>((resolve, reject) => {
    recognition.onresult = (event: SpeechRecognitionEventResult) => {
      let finalText = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript
        }
      }

      const elapsed = (performance.now() - t0) / 1000
      const raw = finalText.trim()
      const text = refineText(raw)

      console.log(`[voice] Transcribed in ${elapsed.toFixed(2)}s: "${text.slice(0, 60)}..."`)

      resolve({
        text,
        language: event.results[0]?.[0]?.language ?? 'en-US',
        duration: elapsed,
      })
    }

    recognition.onerror = (event: { error: string }) => {
      console.error('[voice] Speech recognition error:', event.error)
      if (event.error === 'no-speech') {
        resolve({ text: '', language: 'en-US', duration: 0 })
      } else {
        reject(new Error(`Speech recognition error: ${event.error}`))
      }
    }

    recognition.onend = () => {
      // If no result was received, resolve with empty
    }
  })

  recognition.start()

  return {
    promise,
    stop: () => {
      recognition.stop()
    },
  }
}
