/**
 * SOVARA Tool Infrastructure - Main Export
 * Comprehensive tool system based on DeepSeek Harness architecture
 */

// Types
export * from './types';

// Core Registry
export { ToolRegistry, getToolRegistry, resetToolRegistry } from './ToolRegistry';

// Execution Scheduler
export { ToolExecutionScheduler, ExecutionPolicies } from './ExecutionScheduler';

// MCP Adapter
export { MCPToolAdapter, createMCPServerConfig } from './MCPToolAdapter';

// PTC Handler
export { PTCToolHandler, createRunCodeToolHandler } from './PTCToolHandler';

// Presentation
export { ToolPresentation, toolPresentation } from './ToolPresentation';

// ============================================================================
// Convenience Imports
// ============================================================================

import { ToolRegistry, getToolRegistry } from './ToolRegistry';
import { ToolExecutionScheduler, ExecutionPolicies } from './ExecutionScheduler';
import { MCPToolAdapter, createMCPServerConfig } from './MCPToolAdapter';
import { PTCToolHandler, createRunCodeToolHandler } from './PTCToolHandler';
import { ToolPresentation, toolPresentation } from './ToolPresentation';
import { ToolDefinition, ToolHook, ToolHandler } from './types';

/**
 * Tool Infrastructure Manager - Coordinates all tool subsystems
 */
export class ToolInfrastructure {
  private registry: ToolRegistry;
  private scheduler: ToolExecutionScheduler;
  private mcpAdapter: MCPToolAdapter;
  private ptcHandler: PTCToolHandler;
  private presentation: ToolPresentation;
  private initialized = false;

  constructor() {
    this.registry = getToolRegistry();
    this.scheduler = new ToolExecutionScheduler(this.registry);
    this.mcpAdapter = new MCPToolAdapter(this.registry);
    this.ptcHandler = new PTCToolHandler(this.registry);
    this.presentation = toolPresentation;
  }

  /**
   * Initialize the tool infrastructure
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register built-in tools
    this.registerBuiltInTools();

    // Register PTC run_code tool
    this.registerPTCTool();

    // Connect to configured MCP servers
    await this.mcpAdapter.connectAll();

    this.initialized = true;
    console.log('[ToolInfrastructure] Initialized successfully');
  }

  /**
   * Shutdown the tool infrastructure
   */
  async shutdown(): Promise<void> {
    await this.mcpAdapter.disconnectAll();
    this.scheduler.cancelAll();
    this.ptcHandler.clear();
    this.initialized = false;
    console.log('[ToolInfrastructure] Shutdown complete');
  }

  // =========================================================================
  // Registry Access
  // =========================================================================

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * Register a tool
   */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.registry.register(definition, handler);
  }

  /**
   * Register a tool with hooks
   */
  registerToolWithHooks(
    definition: ToolDefinition,
    handler: ToolHandler,
    hooks: ToolHook[]
  ): void {
    this.registry.registerWithHooks(definition, handler, hooks);
  }

  /**
   * List all tools
   */
  listTools(): ToolDefinition[] {
    return this.registry.list();
  }

  /**
   * Get tool schema for LLM
   */
  getToolsSchema(): object[] {
    return this.registry.exportToolsSchema();
  }

  // =========================================================================
  // Execution
  // =========================================================================

  getScheduler(): ToolExecutionScheduler {
    return this.scheduler;
  }

  /**
   * Execute a tool
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    options?: { policy?: { mode: 'parallel' | 'exclusive'; barrier?: string } }
  ): Promise<ReturnType<ToolRegistry['execute']>> {
    const policy = options?.policy || { mode: 'parallel' };
    return this.scheduler.schedule(toolName, args, policy);
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeParallel(
    calls: Array<{ toolName: string; args: Record<string, unknown> }>
  ): Promise<ReturnType<ToolExecutionScheduler['scheduleParallel']>> {
    return this.scheduler.scheduleParallel(
      calls.map((c) => ({ toolName: c.toolName, arguments: c.args }))
    );
  }

  // =========================================================================
  // MCP
  // =========================================================================

  getMCPAdapter(): MCPToolAdapter {
    return this.mcpAdapter;
  }

  /**
   * Register an MCP server
   */
  registerMCPServer(config: ReturnType<typeof createMCPServerConfig>): void {
    this.mcpAdapter.registerServer(config);
  }

  /**
   * Connect to an MCP server
   */
  async connectMCPServer(serverId: string): Promise<void> {
    await this.mcpAdapter.connectServer(serverId);
  }

  /**
   * List MCP tools
   */
  listMCPTools(serverId?: string): ToolDefinition[] {
    if (serverId) {
      return this.mcpAdapter.listServerTools(serverId);
    }
    return this.registry.listByTag('mcp');
  }

  // =========================================================================
  // PTC
  // =========================================================================

  getPTCHandler(): PTCToolHandler {
    return this.ptcHandler;
  }

  /**
   * Run code with tool access
   */
  async runWithTools(code: string): Promise<{
    result: unknown;
    toolCalls: Array<{
      toolName: string;
      arguments: Record<string, unknown>;
      result: unknown;
      error?: string;
      timestamp: number;
    }>;
    executionTime: number;
  }> {
    return this.ptcHandler.runWithTools(code);
  }

  // =========================================================================
  // Presentation
  // =========================================================================

  getPresentation(): ToolPresentation {
    return this.presentation;
  }

  /**
   * Get tool presentation for UI
   */
  getToolPresentation(tool: ToolDefinition) {
    return this.presentation.createPresentation(tool);
  }

  /**
   * Generate tool documentation
   */
  generateDocumentation(): string {
    return this.presentation.generateMarkdown(this.listTools());
  }

  // =========================================================================
  // Built-in Tools
  // =========================================================================

  private registerBuiltInTools(): void {
    // These are placeholder definitions - actual implementation in ToolStubAdapter
    const builtInTools: Array<{ name: string; description: string }> = [
      { name: 'web_search', description: 'Search the web for information' },
      { name: 'web_fetch', description: 'Fetch content from a URL' },
      { name: 'fs_list', description: 'List directory contents' },
      { name: 'fs_read', description: 'Read file contents' },
      { name: 'fs_write', description: 'Write content to a file' },
      { name: 'shell_exec', description: 'Execute a shell command' },
      { name: 'todo_write', description: 'Write a todo item' },
      { name: 'memory', description: 'Access persistent memory' },
    ];

    console.log(`[ToolInfrastructure] Registered ${builtInTools.length} built-in tool stubs`);
  }

  private registerPTCTool(): void {
    const runCodeDefinition: ToolDefinition = {
      id: 'run_code',
      name: 'run_code',
      description:
        'Execute JavaScript code with programmatic access to other tools. ' +
        'Tools are available as async functions: await tools.toolName(args)',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'JavaScript code to execute',
          },
          language: {
            type: 'string',
            description: 'Programming language (currently only javascript)',
            default: 'javascript',
            enum: ['javascript', 'js'],
          },
        },
        required: ['code'],
      },
      concurrency: 'exclusive',
      timeout: 60000,
      tags: ['code', 'ptc'],
    };

    const handler = createRunCodeToolHandler(this.ptcHandler);
    this.registry.register(runCodeDefinition, handler);
  }

  // =========================================================================
  // Hooks
  // =========================================================================

  /**
   * Add a global pre-execute hook
   */
  addPreExecuteHook(hook: ToolHook): void {
    this.registry.addGlobalHook(hook);
  }

  /**
   * Add a global guard hook
   */
  addGuardHook(hook: ToolHook): void {
    this.registry.addGlobalHook(hook);
  }

  /**
   * Add a global around hook (e.g., for logging, retry logic)
   */
  addAroundHook(hook: ToolHook): void {
    this.registry.addGlobalHook(hook);
  }

  /**
   * Add a global post-execute hook
   */
  addPostExecuteHook(hook: ToolHook): void {
    this.registry.addGlobalHook(hook);
  }

  /**
   * Add a global result hook
   */
  addResultHook(hook: ToolHook): void {
    this.registry.addGlobalHook(hook);
  }

  // =========================================================================
  // Status
  // =========================================================================

  getStatus(): {
    initialized: boolean;
    toolCount: number;
    mcpServers: Array<{ id: string; name: string; connected: boolean }>;
    executionStatus: ReturnType<ToolExecutionScheduler['getStatus']>;
  } {
    return {
      initialized: this.initialized,
      toolCount: this.registry.list().length,
      mcpServers: this.mcpAdapter.listServers().map((s) => ({
        id: s.id,
        name: s.name,
        connected: this.mcpAdapter.getServerStatus(s.id)?.connected || false,
      })),
      executionStatus: this.scheduler.getStatus(),
    };
  }

  /**
   * Get total registered tool count
   */
  getToolCount(): number {
    return this.registry.list().length;
  }

  /**
   * Get recent tool execution log entries
   */
  getExecutionLogs(limit: number = 100): Array<{
    id: string;
    toolName: string;
    status: 'success' | 'error' | 'cancelled';
    durationMs: number;
    timestamp: number;
    sessionId?: string;
  }> {
    return this.registry.getExecutionLogs(limit);
  }
}

// Singleton instance
let toolInfrastructureInstance: ToolInfrastructure | null = null;

export function getToolInfrastructure(): ToolInfrastructure {
  if (!toolInfrastructureInstance) {
    toolInfrastructureInstance = new ToolInfrastructure();
  }
  return toolInfrastructureInstance;
}

export async function initializeToolInfrastructure(): Promise<ToolInfrastructure> {
  const infra = getToolInfrastructure();
  await infra.initialize();
  return infra;
}

export async function shutdownToolInfrastructure(): Promise<void> {
  if (toolInfrastructureInstance) {
    await toolInfrastructureInstance.shutdown();
    toolInfrastructureInstance = null;
  }
}
