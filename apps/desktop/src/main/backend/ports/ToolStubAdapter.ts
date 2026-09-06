import type { ToolDefinition, ToolPort } from '@shared/types/ports'

export class ToolStubAdapter implements ToolPort {
  list(): ToolDefinition[] {
    return []
  }
  async dispatch(_name: string, _args: Record<string, unknown>): Promise<string> {
    return JSON.stringify({ error: 'tool-unavailable-in-Phase1' })
  }
}
