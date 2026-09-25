/**
 * Background subagent jobs.
 *
 * The main agent's tool loop is already a correct suspend/resume point: it
 * awaits a tool result, pushes it as a `role: 'tool'` message, and continues.
 * A subagent therefore needs no new orchestration primitive — it needs an
 * independently-keyed execution slot plus a job record the UI can observe.
 *
 * Design constraints that shaped this:
 *
 * - **No request collision.** The main orchestrator guards on one in-flight
 *   turn per *real* session. A subagent must not occupy that slot, or the parent
 *   turn and the child would fight over the same AbortController and stream.
 *   Jobs are keyed by their own `jobId`; the parent's `sessionId` is carried on
 *   the record purely so events reach the right renderer filter.
 * - **One resident model.** `maxConcurrentModels === 1`, and LRU eviction refuses
 *   while a request is active. A subagent therefore pins to whatever model is
 *   already resident and fails fast rather than queueing behind an eviction
 *   that can never succeed.
 * - **Honest results.** A subagent's answer is only ever returned after it
 *   actually finished. Cancellation, deadline expiry and errors all resolve to an
 *   explicit status — never to a fabricated "done".
 * - **No unbounded fan-out.** A subagent runs with the delegation tool removed
 *   from its own catalog, so it cannot spawn another subagent.
 */

export type SubagentRole = 'explore' | 'general'
export type SubagentStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface SubagentJob {
  /** Unique, stable job id. Also the in-flight key — never a session id. */
  jobId: string
  /** The real parent session. Events carry this so the renderer filter works. */
  parentSessionId: string
  toolCallId: string
  role: SubagentRole
  description: string
  status: SubagentStatus
  startedAt: number
  endedAt?: number
  result?: string
  error?: string
  modelId?: string
  steps?: number
}

export interface SubagentResult {
  jobId: string
  status: SubagentStatus
  result?: string
  error?: string
  modelId?: string
  steps?: number
  durationMs: number
}

export interface SubagentRunnerDeps {
  /**
   * Execute one independent sub-turn. Implementations must NOT reuse the
   * parent's in-flight slot.
   */
  runSubagent: (input: {
    jobId: string
    parentSessionId: string
    toolCallId: string
    role: SubagentRole
    description: string
    signal: AbortSignal
  }) => Promise<{ text: string; modelId?: string; steps?: number }>
  /** Pin to the resident model id, or null when nothing is loaded. */
  getResidentModelId: () => string | null
  /** Record the sub-run against the shared runtime so it is not evicted. */
  noteRequestStart?: (modelId: string) => void
  noteRequestEnd?: (modelId: string) => void
}

const DEFAULT_DEADLINE_MS = 5 * 60_000
const MAX_DESCRIPTION_CHARS = 4_000
const MAX_RESULT_CHARS = 8_000

let jobCounter = 0

function makeJobId(): string {
  jobCounter += 1
  return `sub_${Date.now().toString(36)}_${jobCounter.toString(36)}`
}

export class SubagentRunner {
  private readonly jobs = new Map<string, SubagentJob>()
  private readonly controllers = new Map<string, AbortController>()

  constructor(private readonly deps: SubagentRunnerDeps) {}

  list(): SubagentJob[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  listForSession(parentSessionId: string): SubagentJob[] {
    return this.list().filter((job) => job.parentSessionId === parentSessionId)
  }

  get(jobId: string): SubagentJob | undefined {
    return this.jobs.get(jobId)
  }

  /**
   * Start a subagent. Returns immediately with a job id; the promise settles
   * only when the subagent has genuinely finished.
   */
  dispatch(input: {
    parentSessionId: string
    toolCallId: string
    role?: unknown
    description?: unknown
    deadlineMs?: number
  }): { jobId: string; done: Promise<SubagentResult> } {
    const description = typeof input.description === 'string' ? input.description.trim() : ''
    if (!description) {
      throw new Error('invoke_subagent requires a non-empty { description: string }')
    }
    const role: SubagentRole = input.role === 'explore' ? 'explore' : 'general'

    const jobId = makeJobId()
    const controller = new AbortController()
    const modelId = this.deps.getResidentModelId()

    const job: SubagentJob = {
      jobId,
      parentSessionId: input.parentSessionId,
      toolCallId: input.toolCallId,
      role,
      description: description.slice(0, MAX_DESCRIPTION_CHARS),
      status: 'running',
      startedAt: Date.now(),
      modelId: modelId ?? undefined,
    }
    this.jobs.set(jobId, job)
    this.controllers.set(jobId, controller)

    if (modelId) this.deps.noteRequestStart?.(modelId)

    const deadlineMs =
      typeof input.deadlineMs === 'number' && input.deadlineMs > 0
        ? Math.min(input.deadlineMs, DEFAULT_DEADLINE_MS)
        : DEFAULT_DEADLINE_MS

    const done = this.execute(job, controller.signal, deadlineMs)
    return { jobId, done }
  }

  private async execute(
    job: SubagentJob,
    signal: AbortSignal,
    deadlineMs: number,
  ): Promise<SubagentResult> {
    const started = Date.now()
    const finish = (
      status: SubagentStatus,
      extra: Pick<SubagentJob, 'result' | 'error' | 'steps'>,
    ): SubagentResult => {
      job.status = status
      job.endedAt = Date.now()
      job.result = extra.result
      job.error = extra.error
      job.steps = extra.steps
      this.controllers.delete(job.jobId)
      if (job.modelId) this.deps.noteRequestEnd?.(job.modelId)
      return {
        jobId: job.jobId,
        status,
        result: extra.result,
        error: extra.error,
        modelId: job.modelId,
        steps: extra.steps,
        durationMs: Date.now() - started,
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`subagent-deadline-exceeded after ${deadlineMs}ms`)),
          deadlineMs,
        )
      })
      const outcome = await Promise.race([
        this.deps.runSubagent({
          jobId: job.jobId,
          parentSessionId: job.parentSessionId,
          toolCallId: job.toolCallId,
          role: job.role,
          description: job.description,
          signal,
        }),
        timeout,
      ])

      if (signal.aborted) return finish('cancelled', { error: 'cancelled' })

      const text = typeof outcome?.text === 'string' ? outcome.text.trim() : ''
      if (!text) return finish('failed', { error: 'subagent produced no answer' })
      if (outcome.modelId) job.modelId = outcome.modelId

      return finish('succeeded', {
        result: text.slice(0, MAX_RESULT_CHARS),
        steps: outcome.steps,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (signal.aborted) return finish('cancelled', { error: 'cancelled' })
      return finish('failed', { error: message })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    const controller = this.controllers.get(jobId)
    if (!job || !controller) return false
    controller.abort()
    return true
  }

  /** Cancel every child of a turn. Used when the parent is cancelled. */
  cancelForSession(parentSessionId: string): number {
    let cancelled = 0
    for (const job of this.listForSession(parentSessionId)) {
      if (this.cancel(job.jobId)) cancelled += 1
    }
    return cancelled
  }

  /** Called on app shutdown so no child keeps the model resident. */
  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }
}
