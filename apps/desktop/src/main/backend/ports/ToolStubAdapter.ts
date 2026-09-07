import type { ToolDefinition, ToolPort } from '@shared/types/ports'
import {
  WEB_SEARCH_MAX_QUERIES,
  WEB_SEARCH_MAX_RESULTS,
  formatSearchOutcome,
  parseSearchQueries,
  runDeepSeekSearch,
  type DeepSeekSearchOptions,
} from '../../services/deepseekSearch'

export interface WebSearchConfig {
  enabled: boolean
  options: DeepSeekSearchOptions
}

/**
 * Tool registry: `web_search` (DeepSeek native server tool) is live;
 * everything else is still a Phase 1 stub. The resolver thunk keeps settings
 * reads at dispatch time so a settings write between calls takes effect.
 */
export class ToolStubAdapter implements ToolPort {
  constructor(private readonly resolveWebSearch: () => WebSearchConfig = () => ({
    enabled: false,
    options: {
      apiKey: undefined,
      baseURL: 'https://api.deepseek.com/anthropic/v1',
      model: 'deepseek-chat',
      apiVersion: '2023-06-01',
      maxTokens: 4096,
      maxUses: 5,
      timeoutMs: 30000,
    },
  })) {}

  list(): ToolDefinition[] {
    return [
      {
        name: 'web_search',
        toolset: 'web',
        description: 'Search the web for current information. Input: { queries: string[] } (1-4 queries). Returns cited sources.',
        parameters: {
          type: 'object',
          properties: { queries: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: WEB_SEARCH_MAX_QUERIES } },
          required: ['queries'],
        },
      },
    ]
  }

  async dispatch(name: string, args: Record<string, unknown>): Promise<string> {
    if (name !== 'web_search') return JSON.stringify({ error: 'tool-unavailable-in-Phase1' })
    const cfg = this.resolveWebSearch()
    if (!cfg.enabled) return JSON.stringify({ error: 'web_search disabled — enable it in Settings → Agent → Web search.' })
    let queries: string[]
    try {
      queries = parseSearchQueries(args['queries'], WEB_SEARCH_MAX_QUERIES)
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
    }
    try {
      const outcomes = await Promise.all(queries.map((q) => runDeepSeekSearch(q, cfg.options)))
      const seen = new Set<string>()
      const merged = outcomes.flatMap((o) => o.sources).filter((s) => !seen.has(s.url) && (seen.add(s.url), true))
      const truncated = merged.length > WEB_SEARCH_MAX_RESULTS
      const capped = merged.slice(0, WEB_SEARCH_MAX_RESULTS)
      return formatSearchOutcome({ sources: capped, truncated: truncated || outcomes.length > 1 })
    } catch (e) {
      const code = (e as { code?: string }).code
      return JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        ...(typeof code === 'string' ? { code } : {}),
      })
    }
  }
}
