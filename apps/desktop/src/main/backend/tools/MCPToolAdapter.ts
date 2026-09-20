/**
 * SOVARA Tool Infrastructure - MCP Tool Adapter
 * Integration with MCP servers exposing tools as mcp_<serverId>_<toolName>
 */

import { EventEmitter } from 'events';
const uuidv4 = () => crypto.randomUUID();
import {
  ToolDefinition,
  ToolExecutionContext,
  ToolHandler,
  MCPServerConfig,
  MCPToolDefinition,
} from './types';
import { ToolRegistry } from './ToolRegistry';

interface MCPClient {
  id: string;
  name: string;
  connected: boolean;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * MCP Tool Adapter - Manages MCP server connections and tool exposure
 */
export class MCPToolAdapter extends EventEmitter {
  private registry: ToolRegistry;
  private clients: Map<string, MCPClient> = new Map();
  private servers: Map<string, MCPServerConfig> = new Map();
  private toolPrefix = 'mcp_';

  constructor(registry: ToolRegistry) {
    super();
    this.registry = registry;
  }

  /**
   * Register an MCP server configuration
   */
  registerServer(config: MCPServerConfig): void {
    this.servers.set(config.id, config);
    console.log(`[MCPToolAdapter] Registered server: ${config.name} (${config.id})`);
  }

  /**
   * Unregister an MCP server
   */
  async unregisterServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) return;

    // Unregister all tools from this server
    const tools = this.listServerTools(serverId);
    for (const tool of tools) {
      this.registry.unregister(tool.name);
    }

    // Disconnect client if connected
    const client = this.clients.get(serverId);
    if (client) {
      await client.disconnect();
      this.clients.delete(serverId);
    }

    this.servers.delete(serverId);
    console.log(`[MCPToolAdapter] Unregistered server: ${server.name}`);
  }

  /**
   * Connect to an MCP server
   */
  async connectServer(serverId: string): Promise<void> {
    const config = this.servers.get(serverId);
    if (!config) {
      throw new Error(`MCP server '${serverId}' is not registered`);
    }

    if (this.clients.has(serverId)) {
      console.log(`[MCPToolAdapter] Server already connected: ${serverId}`);
      return;
    }

    // Create MCP client based on transport
    const client = await this.createClient(config);
    await client.connect();
    
    this.clients.set(serverId, client);
    
    // Register tools
    await this.registerServerTools(serverId, client);
    
    this.emit('server:connected', { serverId, serverName: config.name });
    console.log(`[MCPToolAdapter] Connected to server: ${config.name}`);
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (!client) return;

    await client.disconnect();
    this.clients.delete(serverId);
    
    // Unregister tools
    const tools = this.listServerTools(serverId);
    for (const tool of tools) {
      this.registry.unregister(tool.name);
    }

    const config = this.servers.get(serverId);
    this.emit('server:disconnected', { serverId, serverName: config?.name });
  }

  /**
   * Connect to all registered servers
   */
  async connectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [serverId, config] of this.servers) {
      if (config.enabled !== false) {
        promises.push(this.connectServer(serverId).catch((err) => {
          console.error(`[MCPToolAdapter] Failed to connect to ${serverId}:`, err);
        }));
      }
    }
    await Promise.allSettled(promises);
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const serverId of this.servers.keys()) {
      promises.push(this.disconnectServer(serverId));
    }
    await Promise.allSettled(promises);
  }

  /**
   * Create an MCP client based on transport type
   */
  private async createClient(config: MCPServerConfig): Promise<MCPClient> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    
    if (config.transport !== 'stdio') {
      throw new Error(`Only stdio transport is currently supported, got: ${config.transport}`)
    }
    if (!config.command) {
      throw new Error(`Command is required for stdio transport`)
    }

    const envConfig = { ...process.env, ...(config.env || {}) }
    const filteredEnv = Object.fromEntries(
      Object.entries(envConfig).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: filteredEnv,
    })

    const mcp = new Client(
      { name: "sovara-client", version: "1.0.0" },
      { capabilities: {} }
    )

    const client: MCPClient = {
      id: config.id,
      name: config.name,
      connected: false,
      tools: [],
      callTool: async (name: string, args: Record<string, unknown>) => {
        if (!client.connected) throw new Error(`MCP client ${config.id} is not connected`)
        const result = await mcp.callTool({ name, arguments: args })
        if (result.isError) {
          const first = (result.content as any[])?.[0]
          throw new Error(String(first?.text || 'Unknown MCP tool error'))
        }
        const first = (result.content as any[])?.[0]
        return { success: true, tool: name, args, output: String(first?.text || '') }
      },
      connect: async () => {
        await mcp.connect(transport)
        client.connected = true
        const res = await mcp.listTools()
        client.tools = res.tools.map((t) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema as any,
        }))
      },
      disconnect: async () => {
        await mcp.close()
        client.connected = false
        client.tools = []
      },
    }

    return client
  }

  /**
   * Register tools from an MCP server
   */
  private async registerServerTools(serverId: string, client: MCPClient): Promise<void> {
    for (const tool of client.tools) {
      const toolName = `${this.toolPrefix}${serverId}_${tool.name}`;
      
      const definition: MCPToolDefinition = {
        id: toolName,
        name: toolName,
        description: tool.description,
        inputSchema: this.convertMCPToSchema(tool.inputSchema),
        serverId,
        originalName: tool.name,
        concurrency: 'parallel',
        timeout: 30000,
        tags: ['mcp', serverId],
      };

      const handler: ToolHandler = async (args, context) => {
        return this.handleMCPToolCall(serverId, tool.name, args, context);
      };

      this.registry.register(definition, handler);
    }
  }

  /**
   * Handle an MCP tool call
   */
  private async handleMCPToolCall(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const client = this.clients.get(serverId);
    if (!client || !client.connected) {
      throw new Error(`MCP server '${serverId}' is not connected`);
    }

    this.emit('tool:call', {
      serverId,
      toolName,
      arguments: args,
      toolCallId: context.toolCallId,
    });

    try {
      const result = await client.callTool(toolName, args);
      this.emit('tool:result', {
        serverId,
        toolName,
        result,
        toolCallId: context.toolCallId,
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('tool:error', {
        serverId,
        toolName,
        error: errorMessage,
        toolCallId: context.toolCallId,
      });
      throw error;
    }
  }

  /**
   * Convert MCP input schema to internal schema format
   */
  private convertMCPToSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
    // MCP uses JSON Schema-like format, convert to our format
    return {
      type: inputSchema.type || 'object',
      properties: inputSchema.properties || {},
      required: inputSchema.required || [],
      ...inputSchema,
    };
  }

  /**
   * List all tools from a specific server
   */
  listServerTools(serverId: string): ToolDefinition[] {
    return this.registry.listByTag(serverId);
  }

  /**
   * List all MCP servers
   */
  listServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get MCP server status
   */
  getServerStatus(serverId: string): { connected: boolean; toolCount: number } | null {
    const client = this.clients.get(serverId);
    if (!client) return null;

    return {
      connected: client.connected,
      toolCount: client.tools.length,
    };
  }

  /**
   * Get tool name with prefix
   */
  getToolName(serverId: string, toolName: string): string {
    return `${this.toolPrefix}${serverId}_${toolName}`;
  }

  /**
   * Parse tool name to extract server and tool
   */
  parseToolName(fullName: string): { serverId: string; toolName: string } | null {
    if (!fullName.startsWith(this.toolPrefix)) {
      return null;
    }

    const parts = fullName.slice(this.toolPrefix.length).split('_', 2);
    if (parts.length !== 2) {
      return null;
    }

    return {
      serverId: parts[0],
      toolName: parts[1],
    };
  }
}

/**
 * Create standard MCP server configuration
 */
export function createMCPServerConfig(
  id: string,
  name: string,
  config: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    transport?: 'stdio' | 'http' | 'sse';
  }
): MCPServerConfig {
  return {
    id,
    name,
    command: config.command,
    args: config.args,
    env: config.env,
    url: config.url,
    transport: config.transport || 'stdio',
    enabled: true,
  };
}
