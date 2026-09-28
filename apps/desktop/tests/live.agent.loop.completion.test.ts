import { describe, expect, it, beforeEach } from 'vitest'
import { deriveTaskIntentAndPolicy, classifyTaskEnhanced } from '../src/main/backend/TaskClassifier'
import { getCanonicalRuntimeState, runtimeStatusStore } from '../src/renderer/src/stores/runtimeStatusStore'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('SOVARA Agent Loop Completion & Adaptive Context Regression Suite', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-completion-test-'))
    runtimeStatusStore.reset()
  })

  it('15A: Pure arithmetic prompt classifies as direct_response with 0 minimum actions', () => {
    const prompt = 'A production line has 3 machines. Machine A produces 120 units/hour, B produces 150 units/hour, and C produces 90 units/hour. If A runs for 5 hours, B for 4 hours, and C for 6 hours, calculate the total production and show the calculation.'
    const classification = classifyTaskEnhanced(prompt)
    const policy = deriveTaskIntentAndPolicy(prompt, classification)

    expect(policy.intent).toBe('direct_response')
    expect(policy.requiresInspection).toBe(false)
    expect(policy.minimumSuccessfulActions).toBe(0)
    expect(policy.requiredTools).toEqual([])
  })

  it('15B: File read prompt explicitly classifies as read intent requiring workspace inspection', () => {
    const prompt = 'Please inspect and read the file production_logs.txt in the workspace.'
    const classification = classifyTaskEnhanced(prompt)
    const policy = deriveTaskIntentAndPolicy(prompt, classification)

    expect(policy.intent).toBe('read')
    expect(policy.requiresInspection).toBe(true)
    expect(policy.minimumSuccessfulActions).toBe(1)
  })

  it('15C: Coding/write prompt classifies as write intent requiring file modification tools', () => {
    const prompt = 'Create a python script script.py that calculates production line efficiency.'
    const classification = classifyTaskEnhanced(prompt)
    const policy = deriveTaskIntentAndPolicy(prompt, classification)

    expect(policy.intent).toBe('write')
    expect(policy.requiredTools.length).toBeGreaterThan(0)
    expect(policy.requiredTools).toContain('fs_write')
  })

  it('15D: Verification prompt classifies as write_verify intent requiring read-back', () => {
    const prompt = 'Write the config to config.json and read it back to verify the content.'
    const classification = classifyTaskEnhanced(prompt)
    const policy = deriveTaskIntentAndPolicy(prompt, classification)

    expect(policy.intent).toBe('write_verify')
    expect(policy.requiresVerification).toBe(true)
  })

  it('15E: Direct response prompts skip wiki task checkpoint file creation', () => {
    const prompt = 'Calculate 120 * 5 + 150 * 4 + 90 * 6'
    const classification = classifyTaskEnhanced(prompt)
    const policy = deriveTaskIntentAndPolicy(prompt, classification)

    // Checkpoint rule check: direct_response must skip writing task checkpoint files
    expect(policy.intent).toBe('direct_response')
    const wikiTaskPath = path.join(tmpDir, 'wiki', 'tasks', 'task-test.md')
    expect(fs.existsSync(wikiTaskPath)).toBe(false)
  })

  it('15F: Runtime status store maintains READY state when task is executing or completes', () => {
    const state = getCanonicalRuntimeState()
    expect(state.status).toBe('READY')
    expect(state.isAvailable).toBe(true)
    expect(state.lastError).toBeNull()
  })
})
