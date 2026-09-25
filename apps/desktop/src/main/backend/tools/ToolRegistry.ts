/**
 * SOVARA Tool Infrastructure - Tool Registry
 * Core registry with execution pipeline, hooks, and lifecycle management
 */

const uuidv4 = () => crypto.randomUUID();
import {
  ToolDefinition,
  ToolHandler,
  ToolRegistry as IToolRegistry,
  ToolRegistryOptions,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHook,
  ToolHookContext,
  ToolParameterSchema,
} from './types';

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  hooks: Map<string, ToolHook[]>;
}

interface ExecutionLogEntry {
  id: string;
  toolName: string;
  status: 'success' | 'error' | 'cancelled';
  durationMs: number;
  timestamp: number;
  context?: { sessionId?: string };
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_CONCURRENT = 10;

/**
 * Tool Registry with full lifecycle management
 */
export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private options: Required<ToolRegistryOptions>;
  private globalHooks: Map<string, ToolHook[]> = new Map();
  private executionLog: ExecutionLogEntry[] = [];
  private readonly MAX_LOG_ENTRIES = 500;

  private pushLog(entry: ExecutionLogEntry): void {
    this.executionLog.push(entry);
    if (this.executionLog.length > this.MAX_LOG_ENTRIES) {
      this.executionLog = this.executionLog.slice(-this.MAX_LOG_ENTRIES);
    }
  }

  constructor(options: ToolRegistryOptions = {}) {
    this.options = {
      validateSchema: options.validateSchema ?? true,
      strictMode: options.strictMode ?? false,
      defaultTimeout: options.defaultTimeout ?? DEFAULT_TIMEOUT,
      maxConcurrent: options.maxConcurrent ?? MAX_CONCURRENT,
    };
  }

  /**
   * Register a tool with its handler
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      if (this.options.strictMode) {
        throw new Error(`Tool '${definition.name}' is already registered`);
      }
      console.warn(`Tool '${definition.name}' is being overwritten`);
    }

    if (this.options.validateSchema) {
      this.validateDefinition(definition);
    }

    this.tools.set(definition.name, {
      definition,
      handler,
      hooks: new Map(),
    });

    console.log(`[ToolRegistry] Registered tool: ${definition.name}`);
  }

  /**
   * Register a tool with lifecycle hooks
   */
  registerWithHooks(
    definition: ToolDefinition,
    handler: ToolHandler,
    hooks: ToolHook[]
  ): void {
    this.register(definition, handler);
    
    const tool = this.tools.get(definition.name)!;
    for (const hook of hooks) {
      this.addHook(definition.name, hook);
    }
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const result = this.tools.delete(name);
    if (result) {
      console.log(`[ToolRegistry] Unregistered tool: ${name}`);
    }
    return result;
  }

  /**
   * Get tool definition
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * Get tool handler
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name)?.handler;
  }

  /**
   * List all registered tools
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * List tools by tag
   */
  listByTag(tag: string): ToolDefinition[] {
    return this.list().filter((tool) => tool.tags?.includes(tag));
  }

  /**
   * Check if tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  // =========================================================================
  // Lifecycle Hooks
  // =========================================================================

  /**
   * Add a hook to a specific tool
   */
  addHook(toolName: string, hook: ToolHook): void {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' is not registered`);
    }

    const hooks = tool.hooks.get(hook.type) || [];
    hooks.push(hook);
    tool.hooks.set(hook.type, hooks);
  }

  /**
   * Add a global hook (applies to all tools)
   */
  addGlobalHook(hook: ToolHook): void {
    const hooks = this.globalHooks.get(hook.type) || [];
    hooks.push(hook);
    this.globalHooks.set(hook.type, hooks);
  }

  /**
   * Get hooks for a tool (specific + global)
   */
  getHooks(toolName: string, type: string): ToolHook[] {
    const tool = this.tools.get(toolName);
    const toolHooks = tool?.hooks.get(type) || [];
    const globalHooks = this.globalHooks.get(type) || [];
    return [...globalHooks, ...toolHooks];
  }

  // =========================================================================
  // Execution Pipeline
  // =========================================================================

  /**
   * Execute a tool with full lifecycle management
   */
  async execute(
    toolName: string,
    arguments_: Record<string, unknown>,
    context: Partial<ToolExecutionContext> = {}
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        toolCallId: context.toolCallId || uuidv4(),
        toolName,
        success: false,
        error: `Tool '${toolName}' is not registered`,
        errorCode: 'TOOL_NOT_FOUND',
        executionTime: 0,
      };
    }

    const toolCallId = context.toolCallId || uuidv4();
    const startTime = Date.now();

    const executionContext: ToolExecutionContext = {
      toolCallId,
      toolName,
      arguments: arguments_,
      startTime,
      timeout: tool.definition.timeout || this.options.defaultTimeout,
      ...context,
    };

    const hookContext: ToolHookContext = {
      toolName,
      arguments: arguments_,
      executionContext,
      metadata: {},
    };

    try {
      this.validateArguments(toolName, arguments_);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        toolCallId,
        toolName,
        success: false,
        error: errorMessage,
        errorCode: 'INVALID_ARGUMENTS',
        executionTime: Date.now() - startTime,
      };
    }

    try {
      // Pre-execute hooks
      await this.runPreExecuteHooks(toolName, hookContext);

      // Guard hooks
      await this.runGuardHooks(toolName, hookContext);

      // Around hooks (with timeout/retry logic)
      const result = await this.runAroundHooks(toolName, hookContext, async () => {
        return this.executeWithTimeout(
          tool.handler,
          arguments_,
          executionContext,
          executionContext.timeout!
        );
      });

      // Post-execute hooks
      const execResult: ToolExecutionResult = {
        toolCallId,
        toolName,
        success: true,
        output: result,
        executionTime: Date.now() - startTime,
      };
      await this.runPostExecuteHooks(toolName, hookContext, execResult);

      // Result hooks
      await this.runResultHooks(toolName, hookContext, execResult);

      // Capture in execution log
      this.pushLog({ id: toolCallId, toolName, status: 'success', durationMs: execResult.executionTime, timestamp: startTime, context: { sessionId: context.sessionId } });

      return execResult;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof Error ? error.name : 'EXECUTION_ERROR';

      const execResult: ToolExecutionResult = {
        toolCallId,
        toolName,
        success: false,
        error: errorMessage,
        errorCode,
        executionTime,
      };

      // Still run post-execute and result hooks on error
      await this.runPostExecuteHooks(toolName, hookContext, execResult).catch(() => {});
      await this.runResultHooks(toolName, hookContext, execResult).catch(() => {});

      // Capture in execution log
      this.pushLog({ id: toolCallId, toolName, status: 'error', durationMs: executionTime, timestamp: startTime, context: { sessionId: context.sessionId } });

      return execResult;
    }
  }

  /**
   * Execute with timeout enforcement
   */
  private async executeWithTimeout(
    handler: ToolHandler,
    arguments_: Record<string, unknown>,
    context: ToolExecutionContext,
    timeout: number
  ): Promise<unknown> {
    return Promise.race([
      handler(arguments_, context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool '${context.toolName}' timed out after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Run pre-execute hooks
   */
  private async runPreExecuteHooks(toolName: string, context: ToolHookContext): Promise<void> {
    const hooks = this.getHooks(toolName, 'pre-execute');
    for (const hook of hooks) {
      if (hook.type === 'pre-execute') {
        const result = await hook.execute(context);
        if (result === false) {
          throw new Error('Pre-execute hook blocked execution');
        }
      }
    }
  }

  /**
   * Run guard hooks
   */
  private async runGuardHooks(toolName: string, context: ToolHookContext): Promise<void> {
    const hooks = this.getHooks(toolName, 'guard');
    for (const hook of hooks) {
      if (hook.type === 'guard') {
        const result = await hook.execute(context);
        if (typeof result === 'object' && !result.allowed) {
          throw new Error(result.reason || 'Guard hook blocked execution');
        }
      }
    }
  }

  /**
   * Run around hooks (wrapping the actual execution)
   */
  private async runAroundHooks(
    toolName: string,
    context: ToolHookContext,
    next: () => Promise<unknown>
  ): Promise<unknown> {
    const hooks = this.getHooks(toolName, 'around');
    
    // Chain hooks in reverse order (last hook wraps first)
    let currentNext = next;
    for (const hook of [...hooks].reverse()) {
      if (hook.type === 'around') {
        const hookRef = hook;
        const nextRef = currentNext;
        currentNext = () => hookRef.execute(context, nextRef);
      }
    }

    return currentNext();
  }

  /**
   * Run post-execute hooks
   */
  private async runPostExecuteHooks(
    toolName: string,
    context: ToolHookContext,
    result: ToolExecutionResult
  ): Promise<void> {
    const hooks = this.getHooks(toolName, 'post-execute');
    for (const hook of hooks) {
      if (hook.type === 'post-execute') {
        await hook.execute(context, result);
      }
    }
  }

  /**
   * Run result hooks
   */
  private async runResultHooks(
    toolName: string,
    context: ToolHookContext,
    result: ToolExecutionResult
  ): Promise<void> {
    const hooks = this.getHooks(toolName, 'result');
    for (const hook of hooks) {
      if (hook.type === 'result') {
        await hook.execute(context, result);
      }
    }
  }

  // =========================================================================
  // Schema Validation
  // =========================================================================

  /**
   * Validate tool definition schema
   */
  private validateDefinition(definition: ToolDefinition): void {
    if (!definition.name || typeof definition.name !== 'string') {
      throw new Error('Tool name is required and must be a string');
    }
    if (!definition.description || typeof definition.description !== 'string') {
      throw new Error('Tool description is required and must be a string');
    }
    if (!definition.inputSchema || typeof definition.inputSchema !== 'object') {
      throw new Error('Tool inputSchema is required and must be an object');
    }
  }

  /**
   * Validate arguments against schema
   */
  validateArguments(toolName: string, arguments_: Record<string, unknown>): boolean {
    const definition = this.get(toolName);
    if (!definition) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    return this.validateSchema(definition.inputSchema, arguments_);
  }

  /**
   * Recursive schema validation
   */
  private validateSchema(schema: ToolParameterSchema, value: unknown, path = ''): boolean {
    if (!schema) return true;

    // Check required fields
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in (value as Record<string, unknown>))) {
          throw new Error(`Missing required field: ${path}${req}`);
        }
      }
    }

    // Type validation
    if (schema.type && value !== undefined && value !== null) {
      const expectedType = schema.type;
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      
      if (expectedType !== actualType) {
        throw new Error(
          `Type mismatch at ${path}: expected ${expectedType}, got ${actualType}`
        );
      }

      // Array items validation
      if (expectedType === 'array' && schema.items && Array.isArray(value)) {
        value.forEach((item, index) => {
          this.validateSchema(schema.items!, item, `${path}[${index}].`);
        });
      }

      // Object properties validation
      if (expectedType === 'object' && schema.properties && typeof value === 'object' && value !== null) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in value) {
            this.validateSchema(propSchema, (value as Record<string, unknown>)[key], `${path}${key}.`);
          }
        }
      }
    }

    // String validations
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new Error(`String at ${path} is too short (min: ${schema.minLength})`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new Error(`String at ${path} is too long (max: ${schema.maxLength})`);
      }
      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          throw new Error(`String at ${path} does not match pattern: ${schema.pattern}`);
        }
      }
    }

    // Number validations
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        throw new Error(`Number at ${path} is below minimum: ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        throw new Error(`Number at ${path} exceeds maximum: ${schema.maximum}`);
      }
    }

    return true;
  }

  /**
   * Convert tool definition to JSON Schema (for LLM consumption)
   */
  toJsonSchema(definition: ToolDefinition): object {
    return {
      name: definition.name,
      description: definition.description,
      parameters: this.toJsonSchemaObject(definition.inputSchema),
    };
  }

  /**
   * Convert internal schema to JSON Schema format
   */
  private toJsonSchemaObject(schema: ToolParameterSchema): object {
    const result: Record<string, unknown> = {
      type: schema.type || 'object',
    };

    if (schema.description) {
      result.description = schema.description;
    }
    if (schema.enum) {
      result.enum = schema.enum;
    }
    if (schema.default !== undefined) {
      result.default = schema.default;
    }

    if (schema.type === 'object' && schema.properties) {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, propSchema] of Object.entries(schema.properties)) {
        properties[key] = this.toJsonSchemaObject(propSchema);
        if (schema.required?.includes(key)) {
          required.push(key);
        }
      }

      result.properties = properties;
      if (required.length > 0) {
        result.required = required;
      }
    }

    if (schema.type === 'array' && schema.items) {
      result.items = this.toJsonSchemaObject(schema.items);
    }

    return result;
  }

  /**
   * Export all tools as JSON Schema array
   */
  exportToolsSchema(): object[] {
    return this.list().map((tool) => this.toJsonSchema(tool));
  }

  /**
   * Get recent execution log entries (newest last)
   */
  getExecutionLogs(limit: number = 100): ExecutionLogEntry[] {
    return this.executionLog.slice(-limit);
  }
}

// Singleton instance
let toolRegistryInstance: ToolRegistry | null = null;

export function getToolRegistry(options?: ToolRegistryOptions): ToolRegistry {
  if (!toolRegistryInstance) {
    toolRegistryInstance = new ToolRegistry(options);
  }
  return toolRegistryInstance;
}

export function resetToolRegistry(): void {
  toolRegistryInstance = null;
}
