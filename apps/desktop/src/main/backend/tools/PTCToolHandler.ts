/**
 * SOVARA Tool Infrastructure - PTC (Programmatic Tool Calls) Handler
 * Enables programmatic tool invocation from within code execution
 */

const uuidv4 = () => crypto.randomUUID();
import { ToolRegistry } from './ToolRegistry';
import {
  ToolExecutionContext,
  ToolExecutionResult,
  PTCToolResult,
  PTCContext,
} from './types';

interface PTCOptions {
  maxNestingLevel?: number;
  enableNestedCalls?: boolean;
  timeout?: number;
  captureLogs?: boolean;
}

/**
 * PTC Context Manager - Tracks nested tool calls
 */
class PTCContextManager {
  private contexts: Map<string, PTCContext> = new Map();
  private rootContext: PTCContext | null = null;

  createRootContext(toolCallId?: string): PTCContext {
    const id = toolCallId || uuidv4();
    const context: PTCContext = {
      toolCallId: id,
      nestingLevel: 0,
      results: [],
    };
    this.contexts.set(id, context);
    this.rootContext = context;
    return context;
  }

  createChildContext(parentToolCallId: string, nestingLevel: number): PTCContext | null {
    const parent = this.contexts.get(parentToolCallId);
    if (!parent) return null;

    const child: PTCContext = {
      toolCallId: uuidv4(),
      nestingLevel,
      parentToolCallId: parentToolCallId,
      results: [],
    };
    this.contexts.set(child.toolCallId, child);
    return child;
  }

  getContext(toolCallId: string): PTCContext | undefined {
    return this.contexts.get(toolCallId);
  }

  getRootContext(): PTCContext | null {
    return this.rootContext;
  }

  addResult(toolCallId: string, result: PTCToolResult): void {
    const context = this.contexts.get(toolCallId);
    if (context) {
      context.results.push(result);
    }
  }

  getAllResults(toolCallId: string): PTCToolResult[] {
    const context = this.contexts.get(toolCallId);
    return context?.results || [];
  }

  clear(): void {
    this.contexts.clear();
    this.rootContext = null;
  }
}

/**
 * PTC Tool Handler - Enables programmatic tool calls from code
 */
export class PTCToolHandler {
  private registry: ToolRegistry;
  private contextManager: PTCContextManager;
  private options: Required<PTCOptions>;

  constructor(registry: ToolRegistry, options: PTCOptions = {}) {
    this.registry = registry;
    this.contextManager = new PTCContextManager();
    this.options = {
      maxNestingLevel: options.maxNestingLevel ?? 10,
      enableNestedCalls: options.enableNestedCalls ?? true,
      timeout: options.timeout ?? 60000,
      captureLogs: options.captureLogs ?? true,
    };
  }

  /**
   * Create a tool caller for PTC execution
   */
  createToolCaller(rootToolCallId?: string) {
    const context = this.contextManager.createRootContext(rootToolCallId);
    const self = this;
    
    return {
      /**
       * Call a tool programmatically
       */
      async call<T = unknown>(
        toolName: string,
        args: Record<string, unknown> = {}
      ): Promise<T> {
        // Check nesting level
        if (context.nestingLevel >= self.options.maxNestingLevel) {
          throw new Error(
            `Maximum nesting level (${self.options.maxNestingLevel}) exceeded`
          );
        }

        // Validate tool exists
        if (!self.registry.has(toolName)) {
          throw new Error(`Tool '${toolName}' is not registered`);
        }

        const timestamp = Date.now();
        
        let recorded = false;
        try {
          // Execute tool
          const result = await self.registry.execute(toolName, args, {
            toolCallId: uuidv4(),
            metadata: {
              ptcContext: context.toolCallId,
              ptcNesting: context.nestingLevel,
            },
          });

          const ptcResult: PTCToolResult = {
            toolName,
            arguments: args,
            result: result.output,
            error: result.success ? undefined : result.error,
            timestamp,
          };

          self.contextManager.addResult(context.toolCallId, ptcResult);
          recorded = true;

          if (!result.success) {
            throw new Error(result.error || 'Tool execution failed');
          }

          return result.output as T;
        } catch (error) {
          if (!recorded) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const ptcResult: PTCToolResult = {
              toolName,
              arguments: args,
              result: undefined,
              error: errorMessage,
              timestamp,
            };
            self.contextManager.addResult(context.toolCallId, ptcResult);
          }
          throw error;
        }
      },

      /**
       * Call multiple tools in parallel
       */
      async callAll<T = unknown[]>(
        calls: Array<{ toolName: string; args?: Record<string, unknown> }>
      ): Promise<T> {
        const promises = calls.map((call) =>
          this.call(call.toolName, call.args || {})
        );
        return Promise.all(promises) as Promise<T>;
      },

      /**
       * Get all results from this PTC context
       */
      getResults(): PTCToolResult[] {
        return self.contextManager.getAllResults(context.toolCallId);
      },

      /**
       * Get the context ID
       */
      getContextId(): string {
        return context.toolCallId;
      },

      /**
       * Create a nested tool caller (for sub-agents)
       */
      createNested(parentToolCallId: string) {
        const childContext = self.contextManager.createChildContext(
          parentToolCallId,
          context.nestingLevel + 1
        );
        
        if (!childContext) {
          throw new Error('Parent context not found');
        }

        return {
          call: this.call.bind(this),
          getResults: () => self.contextManager.getAllResults(childContext.toolCallId),
          getContextId: () => childContext.toolCallId,
        };
      },
    };
  }

  /**
   * Run arbitrary code with tool access
   */
  async runWithTools(
    code: string | ((tools: ReturnType<PTCToolHandler['createToolCaller']>) => Promise<unknown>),
    toolCallId?: string
  ): Promise<{
    result: unknown;
    toolCalls: PTCToolResult[];
    executionTime: number;
  }> {
    const startTime = Date.now();
    const caller = this.createToolCaller(toolCallId);

    let result: unknown;
    if (typeof code === 'function') {
      result = await code(caller);
    } else {
      if (typeof code !== 'string' || code.trim() === '') {
        throw new Error('run_code requires a non-empty JavaScript code string');
      }
      // Create a function that has access to tools
      const toolNames = this.registry.list().map((t) => t.name);
      const toolsObject: Record<string, Function> = {};
      
      for (const name of toolNames) {
        toolsObject[name] = async (...args: unknown[]) => caller.call(name, (args[0] as Record<string, unknown>) || {});
      }

      // Execute code in a sandbox-like manner
      // Note: In production, use a proper sandbox (VM2, isolated-vm, etc.)
      const fn = new Function('tools', `return (async () => { ${code} })()`);
      result = await fn(toolsObject);
    }

    return {
      result,
      toolCalls: caller.getResults(),
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Get execution history
   */
  getHistory(toolCallId?: string): PTCToolResult[] {
    if (toolCallId) {
      return this.contextManager.getAllResults(toolCallId);
    }
    const root = this.contextManager.getRootContext();
    return root?.results || [];
  }

  /**
   * Clear all PTC contexts
   */
  clear(): void {
    this.contextManager.clear();
  }

  /**
   * Get available tools for PTC
   */
  getAvailableTools(): Array<{ name: string; description: string }> {
    return this.registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Check if PTC is enabled (run_code tool is registered)
   */
  isEnabled(): boolean {
    return this.registry.has('run_code');
  }
}

/**
 * Built-in run_code tool implementation
 */
export function createRunCodeToolHandler(
  ptcHandler: PTCToolHandler
): import('./types').ToolHandler {
  return async (rawArgs, context) => {
    const args = rawArgs as { code?: unknown; language?: string };
    const language = args.language ?? 'javascript';
    if (typeof args.code !== 'string' || args.code.trim() === '') {
      throw new Error('run_code requires a non-empty JavaScript code string');
    }
    const code = args.code;

    if (language !== 'javascript' && language !== 'js') {
      throw new Error(`Unsupported language: ${language}. Only JavaScript is supported.`);
    }

    const result = await ptcHandler.runWithTools(code, context.toolCallId);

    return {
      output: result.result,
      toolCalls: result.toolCalls,
      executionTime: result.executionTime,
      summary: `Executed ${result.toolCalls.length} tool call(s) in ${result.executionTime}ms`,
    };
  };
}
