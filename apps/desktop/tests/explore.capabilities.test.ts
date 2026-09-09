import { describe, it, expect } from 'vitest'
import {
  classifyCapabilities,
  detectCapabilitiesFromText,
  mergeCapabilities,
} from '../src/main/services/explorerCatalog'

// Live HF shapes (tags as returned by the Hub API).
const UNSLOTH_CODER_TAGS = ['transformers', 'gguf', 'unsloth', 'qwen3', 'qwen', 'text-generation', 'arxiv:2505.09388', 'license:apache-2.0', 'conversational']
const DAVIDAU_TAGS = ['gguf', 'thinking', 'reasoning', 'coder', 'image-text-to-text', 'conversational']

describe('capability classifier (tags + id + families)', () => {
  it('coder GGUF quant with silent tags still gets Code + Tools + Text', () => {
    const caps = classifyCapabilities(UNSLOTH_CODER_TAGS, 'text-generation', 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF')
    expect(caps).toContain('Code')
    expect(caps).toContain('Tools')
    expect(caps).toContain('Text')
  })

  it('vision pipeline + thinking/coder tags surface Vision + Reasoning + Code', () => {
    const caps = classifyCapabilities(DAVIDAU_TAGS, 'image-text-to-text', 'DavidAU/Qwen3.8-27B-TURBO-CODER-GGUF')
    expect(caps).toContain('Vision')
    expect(caps).toContain('Thinking')
    expect(caps).toContain('Code')
  })

  it('r1 reasoning ids get Thinking', () => {
    expect(classifyCapabilities(['gguf'], 'text-generation', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B')).toContain('Thinking')
  })

  it('known families fill gaps: devstral, gemma-3n, gpt-oss', () => {
    expect(classifyCapabilities(['gguf'], 'text-generation', 'mistralai/Devstral-Small-2505')).toContain('Tools')
    expect(classifyCapabilities(['gguf'], 'image-text-to-text', 'google/gemma-3n-E4B-it-GGUF')).toContain('Vision')
    const oss = classifyCapabilities(['gguf'], 'text-generation', 'openai/gpt-oss-20b')
    expect(oss).toContain('Tools')
    expect(oss).toContain('Thinking')
  })

  it('plain text models stay Text-only (no false families)', () => {
    const caps = classifyCapabilities(['transformers', 'safetensors', 'conversational'], 'text-generation', 'org/plain-7b')
    expect(caps).toEqual(['Text'])
  })
})

describe('README capability fallback', () => {
  it('finds tool/code/reasoning/vision phrases', () => {
    const text = 'A vision-language model with native image understanding. Supports function calling and tool use. Excels at coding and long-horizon reasoning with chain of thought.'
    const found = detectCapabilitiesFromText(text)
    expect(found).toEqual(expect.arrayContaining(['Vision', 'Tools', 'Code', 'Thinking']))
  })

  it('ignores encode/decode boilerplate (no bare-code false positive)', () => {
    expect(detectCapabilitiesFromText('Use the encode and decode helpers below.')).toEqual([])
  })

  it('merges in canonical order without duplicates', () => {
    expect(mergeCapabilities(['Text', 'Code'], ['Tools', 'Code'])).toEqual(['Tools', 'Code', 'Text'])
  })
})
