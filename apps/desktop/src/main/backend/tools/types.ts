/**
 * SOVARA Tool Infrastructure - Type Definitions
 * Based on DeepSeek Harness tool architecture
 */

// ============================================================================
// Core Tool Types
// ============================================================================

export type ToolParameterType = 
  | 'string' 
  | 'number' 
  | 'integer' 
  | 'boolean' 
  | 'array' 
  | 'object';

export interface ToolParameterSchema {
  type?: ToolParameterType;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  [key: string]: unknown;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: ToolParameterSchema;
  outputSchema?: ToolParameterSchema;
  concurrency?: 'parallel' | 'exclusive';
  timeout?: number;
  retries?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  startTime: number;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  output?: unknown;
  error?: string;
  errorCode?: string;
  executionTime: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Tool Lifecycle Hooks
// ============================================================================

export type ToolHookType = 
  | 'pre-execute' 
  | 'guard' 
  | 'around' 
  | 'post-execute' 
  | 'result';

export interface ToolHookContext {
  toolName: string;
  arguments: Record<string, unknown>;
  executionContext: ToolExecutionContext;
  metadata: Record<string, unknown>;
}

export interface ToolPreExecuteHook {
  type: 'pre-execute';
  execute(context: ToolHookContext): Promise<boolean | void>;
}

export interface ToolGuardHook {
  type: 'guard';
  execute(context: ToolHookContext): Promise<boolean | { allowed: boolean; reason?: string }>;
}

export interface ToolAroundHook {
  type: 'around';
  execute(
    context: ToolHookContext, 
    next: () => Promise<unknown>
  ): Promise<unknown>;
}

export interface ToolPostExecuteHook {
  type: 'post-execute';
  execute(
    context: ToolHookContext, 
    result: ToolExecutionResult
  ): Promise<void>;
}

export interface ToolResultHook {
  type: 'result';
  execute(
    context: ToolHookContext, 
    result: ToolExecutionResult
  ): Promise<void>;
}

export type ToolHook = 
  | ToolPreExecuteHook 
  | ToolGuardHook 
  | ToolAroundHook 
  | ToolPostExecuteHook 
  | ToolResultHook;

// ============================================================================
// Tool Registry Types
// ============================================================================

export interface ToolRegistryOptions {
  validateSchema?: boolean;
  strictMode?: boolean;
  defaultTimeout?: number;
  maxConcurrent?: number;
}

export interface ToolRegistry {
  register(definition: ToolDefinition, handler: ToolHandler): void;
  unregister(name: string): boolean;
  get(name: string): ToolDefinition | undefined;
  getHandler(name: string): ToolHandler | undefined;
  list(): ToolDefinition[];
  listByTag(tag: string): ToolDefinition[];
  has(name: string): boolean;
}

// ============================================================================
// Tool Handler Types
// ============================================================================

export interface ToolHandler {
  (args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}

export interface AsyncToolHandler {
  (args: Record<string, unknown>, context: ToolExecutionContext): AsyncGenerator<unknown, void, unknown>;
}

// ============================================================================
// Execution Scheduler Types
// ============================================================================

export type ExecutionMode = 'parallel' | 'exclusive';

export interface ExecutionPolicy {
  mode: ExecutionMode;
  maxConcurrent?: number;
  barrier?: string;
}

export interface ScheduledToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  policy: ExecutionPolicy;
  priority?: number;
  scheduledAt: number;
}

// ============================================================================
// MCP Tool Types
// ============================================================================

export interface MCPServerConfig {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'stdio' | 'http' | 'sse';
  enabled?: boolean;
}

export interface MCPToolDefinition extends ToolDefinition {
  serverId: string;
  originalName: string;
}

export interface MCPToolCall {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

// ============================================================================
// PTC (Programmatic Tool Calls) Types
// ============================================================================

export interface PTCToolResult {
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  error?: string;
  timestamp: number;
}

export interface PTCContext {
  toolCallId: string;
  nestingLevel: number;
  parentToolCallId?: string;
  results: PTCToolResult[];
}

// ============================================================================
// Tool Presentation Types
// ============================================================================

export interface ToolPresentation {
  icon?: string;
  label: string;
  description: string;
  category?: string;
  arguments?: ToolArgumentPresentation[];
}

export interface ToolArgumentPresentation {
  name: string;
  label: string;
  description?: string;
  required: boolean;
  type: string;
  placeholder?: string;
  defaultValue?: unknown;
}

export interface ToolCallPresentation {
  toolName: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  result?: unknown;
  error?: string;
}
