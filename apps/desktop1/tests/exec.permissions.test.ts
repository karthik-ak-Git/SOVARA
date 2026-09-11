import { describe, it, expect } from 'vitest'
import { gateDispatch, isSafeTool } from '../src/main/services/execPermissions'

describe('exec permission gate', () => {
  it('off blocks everything', () => {
    const v = gateDispatch('off', 'read_file')
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.reason).toBe('disabled')
  })

  it('ask requires approval for every tool', () => {
    for (const t of ['read_file', 'run_shell', 'delete_db']) {
      const v = gateDispatch('ask', t)
      expect(v.allowed).toBe(false)
      if (!v.allowed) expect(v.reason).toBe('needs-approval')
    }
  })

  it('review auto-runs safe read-only tools, gates risky ones', () => {
    expect(gateDispatch('review', 'read_file')).toEqual({ allowed: true, autoApproved: true })
    expect(gateDispatch('review', 'list_models')).toEqual({ allowed: true, autoApproved: true })
    const risky = gateDispatch('review', 'run_shell')
    expect(risky.allowed).toBe(false)
    if (!risky.allowed) expect(risky.reason).toBe('needs-approval')
  })

  it('allow runs everything without prompting', () => {
    expect(gateDispatch('allow', 'run_shell')).toEqual({ allowed: true, autoApproved: true })
    expect(gateDispatch('allow', 'delete_everything')).toEqual({ allowed: true, autoApproved: true })
  })

  it('classifies safe tools by read-only prefix', () => {
    expect(isSafeTool('read_file')).toBe(true)
    expect(isSafeTool('list')).toBe(true)
    expect(isSafeTool('run_shell')).toBe(false)
    expect(isSafeTool('delete_db')).toBe(false)
  })
})
