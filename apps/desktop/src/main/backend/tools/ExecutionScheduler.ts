/**
 * SOVARA Tool Infrastructure - Execution Scheduler
 * Handles parallel and exclusive tool execution with barrier synchronization
 */

const uuidv4 = () => crypto.randomUUID();
import { ToolRegistry } from './ToolRegistry';
import {
  ExecutionMode,
  ExecutionPolicy,
  ScheduledToolCall,
  ToolExecutionResult,
  ToolExecutionContext,
} from './types';

interface RunningTool {
  id: string;
  toolName: string;
  promise: Promise<ToolExecutionResult>;
  startTime: number;
}

interface Barrier {
  id: string;
  waiting: Set<string>;
  resolve?: () => void;
}

/**
 * Tool Execution Scheduler with parallel and exclusive modes
 */
export class ToolExecutionScheduler {
  private registry: ToolRegistry;
  private runningParallel: Map<string, RunningTool> = new Map();
  private runningExclusive: Map<string, RunningTool> = new Map();
  private barriers: Map<string, Barrier> = new Map();
  private maxConcurrent: number;
  private queue: ScheduledToolCall[] = [];
  private pausedBarriers: Set<string> = new Set();

  constructor(registry: ToolRegistry, maxConcurrent = 10) {
    this.registry = registry;
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Schedule a tool call with execution policy
   */
  async schedule(
    toolName: string,
    arguments_: Record<string, unknown>,
    policy: ExecutionPolicy = { mode: 'parallel' },
    context: Partial<ToolExecutionContext> = {}
  ): Promise<ToolExecutionResult> {
    const id = context.toolCallId || uuidv4();
    
    const scheduledCall: ScheduledToolCall = {
      id,
      toolName,
      arguments: arguments_,
      policy,
      priority: context.metadata?.priority as number || 0,
      scheduledAt: Date.now(),
    };

    // Add to queue and sort by priority
    this.queue.push(scheduledCall);
    this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Handle barrier synchronization
    if (policy.barrier) {
      return this.executeWithBarrier(scheduledCall, policy.barrier);
    }

    // Handle exclusive mode
    if (policy.mode === 'exclusive') {
      return this.executeExclusive(scheduledCall);
    }

    // Handle parallel mode
    return this.executeParallel(scheduledCall);
  }

  /**
   * Execute multiple tools in parallel with bounded pool
   */
  async scheduleParallel(
    calls: Array<{
      toolName: string;
      arguments: Record<string, unknown>;
      context?: Partial<ToolExecutionContext>;
    }>,
    maxConcurrent?: number
  ): Promise<ToolExecutionResult[]> {
    const limit = maxConcurrent || this.maxConcurrent;
    const results: ToolExecutionResult[] = [];
    const pending: Promise<ToolExecutionResult>[] = [];

    for (const call of calls) {
      const promise = this.schedule(call.toolName, call.arguments, { mode: 'parallel' }, call.context || {});
      pending.push(promise);

      // Respect concurrency limit
      if (pending.length >= limit) {
        const result = await Promise.race(pending);
        const index = pending.findIndex((p) => p === result.then);
        if (index !== -1) {
          pending.splice(index, 1);
        }
        results.push(await result);
      }
    }

    // Wait for remaining
    const remaining = await Promise.all(pending);
    results.push(...remaining);

    return results;
  }

  /**
   * Execute tools exclusively (one at a time)
   */
  private async executeExclusive(call: ScheduledToolCall): Promise<ToolExecutionResult> {
    // Wait if another exclusive tool is running
    while (this.runningExclusive.size > 0) {
      await this.waitForExclusiveSlot();
    }

    const id = call.id;
    const startTime = Date.now();

    const executePromise = this.registry.execute(call.toolName, call.arguments, {
      toolCallId: id,
      startTime,
    });

    this.runningExclusive.set(id, {
      id,
      toolName: call.toolName,
      promise: executePromise,
      startTime,
    });

    try {
      const result = await executePromise;
      return result;
    } finally {
      this.runningExclusive.delete(id);
    }
  }

  /**
   * Execute tools in parallel with bounded pool
   */
  private async executeParallel(call: ScheduledToolCall): Promise<ToolExecutionResult> {
    const id = call.id;
    const startTime = Date.now();

    // Wait if pool is full
    while (this.runningParallel.size >= this.maxConcurrent) {
      await this.waitForPoolSlot();
    }

    const executePromise = this.registry.execute(call.toolName, call.arguments, {
      toolCallId: id,
      startTime,
    });

    this.runningParallel.set(id, {
      id,
      toolName: call.toolName,
      promise: executePromise,
      startTime,
    });

    try {
      const result = await executePromise;
      return result;
    } finally {
      this.runningParallel.delete(id);
    }
  }

  /**
   * Execute with barrier synchronization
   */
  private async executeWithBarrier(
    call: ScheduledToolCall,
    barrierId: string
  ): Promise<ToolExecutionResult> {
    let barrier = this.barriers.get(barrierId);
    
    if (!barrier) {
      barrier = { id: barrierId, waiting: new Set() };
      this.barriers.set(barrierId, barrier);
    }

    barrier.waiting.add(call.id);

    // If we have all expected tools, release the barrier
    if (this.shouldReleaseBarrier(barrierId)) {
      return this.releaseAndExecute(call, barrier!);
    }

    // Wait for barrier
    return new Promise((resolve) => {
      const originalResolve = resolve;
      barrier!.resolve = () => {
        barrier!.waiting.delete(call.id);
        this.executeBarrierTool(call).then(originalResolve);
      };

      // Timeout for barrier wait
      setTimeout(() => {
        if (barrier!.waiting.has(call.id)) {
          barrier!.waiting.delete(call.id);
          this.executeBarrierTool(call).then(originalResolve);
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Release barrier and execute tool
   */
  private async releaseAndExecute(
    call: ScheduledToolCall,
    barrier: Barrier
  ): Promise<ToolExecutionResult> {
    this.barriers.delete(barrier.id);
    
    // Execute the tool
    return this.registry.execute(call.toolName, call.arguments, {
      toolCallId: call.id,
      startTime: Date.now(),
    });
  }

  /**
   * Execute a tool waiting at barrier
   */
  private async executeBarrierTool(call: ScheduledToolCall): Promise<ToolExecutionResult> {
    return this.registry.execute(call.toolName, call.arguments, {
      toolCallId: call.id,
      startTime: Date.now(),
    });
  }

  /**
   * Check if barrier should be released
   */
  private shouldReleaseBarrier(barrierId: string): boolean {
    const barrier = this.barriers.get(barrierId);
    if (!barrier) return false;

    // For now, release when all waiting tools have arrived
    // Could be enhanced with expected count
    return barrier.waiting.size > 0;
  }

  /**
   * Wait for an exclusive slot to become available
   */
  private async waitForExclusiveSlot(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.runningExclusive.size === 0) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * Wait for a pool slot to become available
   */
  private async waitForPoolSlot(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.runningParallel.size < this.maxConcurrent) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * Get current execution status
   */
  getStatus(): {
    runningParallel: number;
    runningExclusive: number;
    queued: number;
    barriers: string[];
  } {
    return {
      runningParallel: this.runningParallel.size,
      runningExclusive: this.runningExclusive.size,
      queued: this.queue.length,
      barriers: Array.from(this.barriers.keys()),
    };
  }

  /**
   * Cancel a running tool
   */
  cancel(toolCallId: string): boolean {
    const parallel = this.runningParallel.delete(toolCallId);
    const exclusive = this.runningExclusive.delete(toolCallId);
    
    // Remove from queue
    const queueIndex = this.queue.findIndex((c) => c.id === toolCallId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    return parallel || exclusive;
  }

  /**
   * Cancel all running tools
   */
  cancelAll(): void {
    this.runningParallel.clear();
    this.runningExclusive.clear();
    this.queue = [];
    this.barriers.clear();
  }

  /**
   * Set maximum concurrent tools
   */
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
  }
}

/**
 * Create execution policies
 */
export const ExecutionPolicies = {
  parallel: (maxConcurrent?: number): ExecutionPolicy => ({
    mode: 'parallel',
    maxConcurrent,
  }),

  exclusive: (barrier?: string): ExecutionPolicy => ({
    mode: 'exclusive',
    barrier,
  }),

  sequential: (): ExecutionPolicy => ({
    mode: 'exclusive',
    barrier: 'sequential',
  }),

  barrier: (barrierId: string): ExecutionPolicy => ({
    mode: 'parallel',
    barrier: barrierId,
  }),
};
