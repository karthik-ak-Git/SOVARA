/**
 * SOVARA Tool Infrastructure - Tool Presentation
 * UI rendering and presentation layer for tools
 */

import { ToolDefinition, ToolCallPresentation, ToolArgumentPresentation } from './types';

interface CategoryConfig {
  name: string;
  icon: string;
  color: string;
  order: number;
}

/**
 * Default category configurations
 */
const DEFAULT_CATEGORIES: Record<string, CategoryConfig> = {
  file: {
    name: 'Files',
    icon: '📁',
    color: '#4A90D9',
    order: 1,
  },
  web: {
    name: 'Web',
    icon: '🌐',
    color: '#50C878',
    order: 2,
  },
  system: {
    name: 'System',
    icon: '⚙️',
    color: '#9B59B6',
    order: 3,
  },
  code: {
    name: 'Code',
    icon: '💻',
    color: '#E67E22',
    order: 4,
  },
  data: {
    name: 'Data',
    icon: '📊',
    color: '#E74C3C',
    order: 5,
  },
  mcp: {
    name: 'MCP',
    icon: '🔌',
    color: '#1ABC9C',
    order: 6,
  },
  misc: {
    name: 'Other',
    icon: '📦',
    color: '#95A5A6',
    order: 99,
  },
};

/**
 * Tool Presentation Service
 */
export class ToolPresentation {
  private categories: Map<string, CategoryConfig> = new Map(
    Object.entries(DEFAULT_CATEGORIES)
  );

  /**
   * Categorize a tool based on its name and tags
   */
  categorizeTool(tool: ToolDefinition): string {
    const name = tool.name.toLowerCase();
    const tags = tool.tags || [];

    // Check MCP tools
    if (name.startsWith('mcp_') || tags.includes('mcp')) {
      return 'mcp';
    }

    // Check file-related tools
    if (
      name.includes('file') ||
      name.includes('fs_') ||
      name.includes('read') ||
      name.includes('write') ||
      tags.includes('file')
    ) {
      return 'file';
    }

    // Check web-related tools
    if (
      name.includes('web') ||
      name.includes('http') ||
      name.includes('fetch') ||
      name.includes('search') ||
      tags.includes('web')
    ) {
      return 'web';
    }

    // Check system tools
    if (
      name.includes('shell') ||
      name.includes('exec') ||
      name.includes('process') ||
      name.includes('system') ||
      tags.includes('system')
    ) {
      return 'system';
    }

    // Check code tools
    if (
      name.includes('code') ||
      name.includes('run') ||
      name.includes('eval') ||
      name.includes('script') ||
      tags.includes('code')
    ) {
      return 'code';
    }

    // Check data tools
    if (
      name.includes('db') ||
      name.includes('data') ||
      name.includes('query') ||
      name.includes('sql') ||
      tags.includes('data')
    ) {
      return 'data';
    }

    return 'misc';
  }

  /**
   * Get category config
   */
  getCategory(category: string): CategoryConfig {
    return this.categories.get(category) || DEFAULT_CATEGORIES.misc;
  }

  /**
   * Get all categories sorted by order
   */
  getCategories(): CategoryConfig[] {
    return Array.from(this.categories.values()).sort((a, b) => a.order - b.order);
  }

  /**
   * Create tool presentation for UI
   */
  createPresentation(tool: ToolDefinition): {
    icon: string;
    label: string;
    description: string;
    category: CategoryConfig;
    arguments: ToolArgumentPresentation[];
    isDeprecated: boolean;
    isExperimental: boolean;
  } {
    const category = this.categorizeTool(tool);
    const categoryConfig = this.getCategory(category);

    return {
      icon: this.getToolIcon(tool),
      label: tool.name,
      description: tool.description,
      category: categoryConfig,
      arguments: this.createArgumentPresentations(tool),
      isDeprecated: tool.tags?.includes('deprecated') || false,
      isExperimental: tool.tags?.includes('experimental') || false,
    };
  }

  /**
   * Get tool icon based on name
   */
  private getToolIcon(tool: ToolDefinition): string {
    const name = tool.name.toLowerCase();

    // Specific tool icons
    if (name.includes('web_search')) return '🔍';
    if (name.includes('web_fetch')) return '📥';
    if (name.includes('file_read') || name.includes('fs_read')) return '📖';
    if (name.includes('file_write') || name.includes('fs_write')) return '✏️';
    if (name.includes('shell')) return '💻';
    if (name.includes('todo')) return '📋';
    if (name.includes('memory')) return '🧠';
    if (name.includes('mcp_')) return '🔌';
    if (name.includes('run_code')) return '▶️';

    // Default icons by category
    const category = this.categorizeTool(tool);
    return this.getCategory(category).icon;
  }

  /**
   * Create argument presentations
   */
  private createArgumentPresentations(
    tool: ToolDefinition
  ): ToolArgumentPresentation[] {
    const schema = tool.inputSchema;
    if (!schema.properties) return [];

    const presentations: ToolArgumentPresentation[] = [];
    const required = schema.required || [];

    for (const [name, propSchema] of Object.entries(schema.properties)) {
      presentations.push({
        name,
        label: this.formatArgName(name),
        description: propSchema.description,
        required: required.includes(name),
        type: this.formatType(propSchema),
        placeholder: this.getPlaceholder(name, propSchema),
        defaultValue: propSchema.default,
      });
    }

    return presentations;
  }

  /**
   * Format argument name for display
   */
  private formatArgName(name: string): string {
    return name
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }

  /**
   * Format type for display
   */
  private formatType(schema: Record<string, unknown>): string {
    const type = schema.type as string;
    
    if (schema.enum) {
      return (schema.enum as unknown[]).map((e) => String(e)).join(' | ');
    }

    if (type === 'array' && schema.items) {
      const itemType = (schema.items as Record<string, unknown>).type || 'any';
      return `${itemType}[]`;
    }

    if (type === 'object' && schema.properties) {
      return 'object';
    }

    return type || 'any';
  }

  /**
   * Get placeholder text
   */
  private getPlaceholder(name: string, schema: Record<string, unknown>): string | undefined {
    const type = schema.type as string;
    
    if (type === 'string') {
      if (name.includes('url')) return 'https://example.com';
      if (name.includes('path')) return '/path/to/file';
      if (name.includes('name')) return 'Enter name...';
      if (name.includes('query')) return 'Search query...';
      return 'Enter text...';
    }

    if (type === 'number' || type === 'integer') {
      return '0';
    }

    if (type === 'boolean') {
      return 'true';
    }

    return undefined;
  }

  /**
   * Create tool call presentation for UI
   */
  createCallPresentation(
    toolName: string,
    arguments_: Record<string, unknown>,
    status: ToolCallPresentation['status'],
    startTime?: number,
    endTime?: number,
    result?: unknown,
    error?: string
  ): ToolCallPresentation {
    return {
      toolName,
      arguments: arguments_,
      status,
      startTime,
      endTime,
      result,
      error,
    };
  }

  /**
   * Format execution result for display
   */
  formatResult(result: unknown, maxLength = 500): string {
    if (result === null) return 'null';
    if (result === undefined) return 'undefined';

    let str: string;
    if (typeof result === 'string') {
      str = result;
    } else {
      try {
        str = JSON.stringify(result, null, 2);
      } catch {
        str = String(result);
      }
    }

    if (str.length > maxLength) {
      return str.slice(0, maxLength) + '... (truncated)';
    }

    return str;
  }

  /**
   * Format error for display
   */
  formatError(error: string): string {
    // Clean up common error patterns
    return error
      .replace(/^Error: /, '')
      .replace(/\n/g, ' ')
      .trim();
  }

  /**
   * Get execution time display
   */
  formatExecutionTime(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${(ms / 60000).toFixed(1)}m`;
  }

  /**
   * Group tools by category
   */
  groupByCategory(tools: ToolDefinition[]): Map<string, ToolDefinition[]> {
    const groups = new Map<string, ToolDefinition[]>();

    for (const tool of tools) {
      const category = this.categorizeTool(tool);
      const existing = groups.get(category) || [];
      existing.push(tool);
      groups.set(category, existing);
    }

    return groups;
  }

  /**
   * Generate markdown documentation for tools
   */
  generateMarkdown(tools: ToolDefinition[]): string {
    const grouped = this.groupByCategory(tools);
    let md = '# Tool Reference\n\n';

    for (const [category, categoryTools] of grouped) {
      const config = this.getCategory(category);
      md += `## ${config.icon} ${config.name}\n\n`;

      for (const tool of categoryTools) {
        md += `### \`${tool.name}\`\n\n`;
        md += `${tool.description}\n\n`;

        if (tool.inputSchema.properties) {
          md += '**Parameters:**\n\n';
          md += '| Name | Type | Required | Description |\n';
          md += '|------|------|----------|-------------|\n';

          const required = tool.inputSchema.required || [];
          for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
            const propSchema = prop as Record<string, unknown>;
            const type = this.formatType(propSchema);
            const isRequired = required.includes(name);
            const desc = propSchema.description || '-';
            md += `| ${name} | ${type} | ${isRequired ? 'Yes' : 'No'} | ${desc} |\n`;
          }
          md += '\n';
        }

        if (tool.tags && tool.tags.length > 0) {
          md += `**Tags:** ${tool.tags.map((t) => `\`${t}\``).join(', ')}\n\n`;
        }
      }
    }

    return md;
  }
}

// Export singleton
export const toolPresentation = new ToolPresentation();
