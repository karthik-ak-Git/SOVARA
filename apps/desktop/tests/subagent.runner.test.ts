import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubagentRunner } from '../src/main/services/subagentRunner'

function makeRunner(overrides: Partial<ConstructorParameters<typeof SubagentRunner>[0]> = {}) {
  const runSubagent = vi.fn(async () => ({ text: 'subagent answer', modelId: 'm1', steps: 1 }))
  const noteRequestStart = vi.fn()
  const noteRequestEnd = vi.fn()
  const runner = new SubagentRunner({
    runSubagent,
    getResidentModelId: () => 'm1',
    noteRequestStart,
    noteRequestEnd,
    ...overrides,
  })
  return { runner, runSubagent, noteRequestStart, noteRequestEnd }
}

describe('SubagentRunner', () => {
  beforeEach(() => vi.useRealTimers())

  it('returns a job id immediately and resolves only after the subagent finishes', async () => {
    let release: (value: { text: string }) => void = () => {}
    const gate = new Promise<{ text: string }>((resolve) => { release = resolve })
    const { runner } = makeRunner({ runSubagent: vi.fn(() => gate) })

    const { jobId, done } = runner.dispatch({
      parentSessionId: 'sess-1',
      toolCallId: 'call-1',
      role: 'explore',
      description: 'find the config file',
    })

    // The handle exists before the work settles, so the UI can render a live card.
    expect(runner.get(jobId)?.status).toBe('running')
    expect(runner.get(jobId)?.parentSessionId).toBe('sess-1')

    let settled = false
    void done.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    release({ text: 'the config lives in src/config.ts' })
    const result = await done

    expect(result.status).toBe('succeeded')
    expect(result.result).toBe('the config lives in src/config.ts')
    expect(runner.get(jobId)?.status).toBe('succeeded')
    expect(settled).toBe(true)
  })

  it('brackets the run with request accounting so the shared model is not evicted', async () => {
    const { runner, noteRequestStart, noteRequestEnd } = makeRunner()
    const { done } = runner.dispatch({ parentSessionId: 'sess-1', toolCallId: 'c', description: 'x' })
    await done
    expect(noteRequestStart).toHaveBeenCalledWith('m1')
    expect(noteRequestEnd).toHaveBeenCalledWith('m1')
  })

  it('rejects an empty description without creating a job', () => {
    const { runner } = makeRunner()
    expect(() => runner.dispatch({ parentSessionId: 's', toolCallId: 'c', description: '   ' }))
      .toThrow(/description/i)
    expect(runner.list()).toHaveLength(0)
  })

  it('defaults an unknown role to general rather than trusting the model', () => {
    const { runner } = makeRunner()
    const { jobId } = runner.dispatch({ parentSessionId: 's', toolCallId: 'c', role: 'root', description: 'x' })
    expect(runner.get(jobId)?.role).toBe('general')
  })

  it('gives every concurrent dispatch a distinct job id', async () => {
    const { runner } = makeRunner()
    const ids = Array.from({ length: 5 }, (_, i) =>
      runner.dispatch({ parentSessionId: 'sess-1', toolCallId: `c${i}`, description: `task ${i}` }).jobId,
    )
    expect(new Set(ids).size).toBe(5)
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        runner.dispatch({ parentSessionId: 'sess-1', toolCallId: `d${i}`, description: `t ${i}` }).done,
      ),
    )
  })

  it('cancels one job without disturbing a sibling', async () => {
    const { runner } = makeRunner()
    const a = runner.dispatch({ parentSessionId: 'sess-1', toolCallId: 'a', description: 'slow' })
    const b = runner.dispatch({ parentSessionId: 'sess-1', toolCallId: 'b', description: 'fast' })

    expect(runner.cancel(a.jobId)).toBe(true)
    const [ra, rb] = await Promise.all([a.done, b.done])
    expect(ra.status).toBe('cancelled')
    expect(rb.status).toBe('succeeded')
  })

  it('reaps every child of a parent session when the turn is cancelled', async () => {
    const { runner } = makeRunner()
    const a = runner.dispatch({ parentSessionId: 'sess-1', toolCallId: 'a', description: 'a' })
    const b = runner.dispatch({ parentSessionId: 'sess-1', toolCallId: 'b', description: 'b' })
    const other = runner.dispatch({ parentSessionId: 'sess-2', toolCallId: 'c', description: 'c' })

    expect(runner.cancelForSession('sess-1')).toBe(2)
    expect((await a.done).status).toBe('cancelled')
    expect((await b.done).status).toBe('cancelled')
    // A different session's subagent must be untouched.
    expect((await other.done).status).toBe('succeeded')
  })

  it('reports a genuine failure instead of inventing an answer', async () => {
    const { runner } = makeRunner({
      runSubagent: vi.fn(async () => { throw new Error('model resident and busy') }),
    })
    const { jobId, done } = runner.dispatch({ parentSessionId: 's', toolCallId: 'c', description: 'x' })
    const result = await done
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/busy/)
    expect(result.result).toBeUndefined()
    expect(runner.get(jobId)?.status).toBe('failed')
  })

  it('treats an empty subagent answer as a failure, not a success', async () => {
    const { runner } = makeRunner({ runSubagent: vi.fn(async () => ({ text: '   ' })) })
    const { done } = runner.dispatch({ parentSessionId: 's', toolCallId: 'c', description: 'x' })
    const result = await done
    expect(result.status).toBe('failed')
    expect(result.result).toBeUndefined()
  })

  it('fails a job that exceeds its deadline', async () => {
    const { runner } = makeRunner({
      runSubagent: vi.fn(() => new Promise<{ text: string }>(() => {})), // never settles
    })
    const { done } = runner.dispatch({
      parentSessionId: 's', toolCallId: 'c', description: 'x', deadlineMs: 25,
    })
    const result = await done
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/deadline/i)
  })

  it('aborts every live job on dispose', async () => {
    const { runner } = makeRunner({
      runSubagent: vi.fn(({ signal }) => new Promise<{ text: string }>((_r, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })),
    })
    const a = runner.dispatch({ parentSessionId: 's', toolCallId: 'a', description: 'x' })
    const b = runner.dispatch({ parentSessionId: 's', toolCallId: 'b', description: 'y' })
    runner.dispose()
    expect((await a.done).status).toBe('cancelled')
    expect((await b.done).status).toBe('cancelled')
  })

  it('scopes listing to the owning session', async () => {
    const { runner } = makeRunner()
    const a = runner.dispatch({ parentSessionId: 'sess-1', toolCallId: 'a', description: 'x' })
    const b = runner.dispatch({ parentSessionId: 'sess-2', toolCallId: 'b', description: 'y' })
    expect(runner.listForSession('sess-1')).toHaveLength(1)
    await Promise.all([a.done, b.done])
  })

  it('truncates an oversized result so it cannot flood the parent context', async () => {
    const { runner } = makeRunner({
      runSubagent: vi.fn(async () => ({ text: 'x'.repeat(50_000) })),
    })
    const { done } = runner.dispatch({ parentSessionId: 's', toolCallId: 'c', description: 'x' })
    const result = await done
    expect(result.status).toBe('succeeded')
    expect(result.result!.length).toBe(8_000)
  })
})
