/**
 * fenceTools — hardened extraction of tool-call fences from model text.
 *
 * Why this exists: the model sometimes emits tool calls as TEXT (streaming
 * split glued two fences together, or used 4+ backticks, or wrote the args
 * with unquoted keys). Those leaks previously fell through every parser,
 * left the bubble showing raw ````tool:…```` markdown, produced an empty
 * effective reply, and surfaced as "empty reply after Ns — auto-compacted".
 *
 * Handles, exactly like the screenshots showed:
 *  - standard ```tool:name\n{json}```
 *  - glued fences:  ```tool:a\n{…}``````tool:b\n{…}```  (6 ticks between)
 *  - 4/5-tick openers and closers (````tool:…````)
 *  - mismatched tick counts (open 4, close 3)
 *  - tool name before or after the ticks (```tool:fs_list / ```fs_list)
 *  - lenient args: unquoted keys, single quotes, trailing commas,
 *    todo_write in the wrong shape ({pending/in_progress/completed:[…]})
 *
 * No logging, no persistence — pure parse. The orchestrator decides what to
 * do with each call (dispatch, persist, strip).
 */

export interface ToolFence {
  toolName: string
  args: Record<string, unknown>
  /** Full matched span including fence ticks — replace it in the original text. */
  raw: string
  index: number
}

const TOOL_NAMES = [
  'fs_list', 'fs_read', 'fs_search', 'fs_write', 'fs_patch',
  'shell_exec', 'bash', 'cmd', 'powershell', 'terminal_exec',
  'list_dev_servers', 'stop_dev_server',
  'todo_write',
  'memory',
  'search_skills', 'read_skill', 'clarify',
  'web_search', 'web_fetch',
  'invoke_subagent',
  'run_code',
] as const
type ToolName = typeof TOOL_NAMES[number]
const TOOL_NAME_PATTERN = TOOL_NAMES.join('|')


/**
 * Lenient JSON: strict parse first; on failure, repair the common model
 * slips. Always returns an args object (never null) — falls back to the
 * tool's sane defaults (fs_list → {path:'.'}, todo_write → {todos:[]}).
 */
export function parseLenientJson(raw: string, toolName?: string): Record<string, unknown> {
  const s = raw.trim()
  if (s === '') return defaultArgsFor(toolName)

  // 0) todo_write wrong-shape repair FIRST — {pending:[…], in_progress:[…],
  //    completed:[…]} is valid strict JSON, so the strict path below would
  //    return it verbatim and dispatch would reject it. (strings or
  //    {content,status} objects) → todos:[{content,status}]
  const shape = s.match(/\{[\s\S]*?"?\bpending"?\s*:[\s\S]*?"?\b(?:in_progress|inProgress)"?\s*:[\s\S]*?"?\b(?:completed|done)"?\s*:[\s\S]*?\}\s*$/i)
  if (shape && !/"?\btodos"?\s*:/i.test(s)) {
    const p0 = s.match(/"?\bpending"?\s*:\s*\[([\s\S]*?)\]/i)
    const p1 = s.match(/"?\b(?:in_progress|inProgress)"?\s*:\s*\[([\s\S]*?)\]/i)
    const p2 = s.match(/"?\b(?:completed|done)"?\s*:\s*\[([\s\S]*?)\]/i)
    const pick = (txt: string | undefined): Array<{ content: string; status: string }> => {
      if (!txt) return []
      const out: Array<{ content: string; status: string }> = []
      const items = txt.match(/"([^"]{1,200})"|'([^']{1,200})'/g) ?? []
      for (const it of items) {
        const content = it.slice(1, -1).trim()
        if (content && content.toLowerCase() !== 'content' && content.toLowerCase() !== 'status') {
          out.push({ content, status: 'pending' })
        }
      }
      return out
    }
    return {
      todos: [
        ...pick(p0?.[1]),
        ...pick(p1?.[1]).map((x) => ({ ...x, status: 'in_progress' })),
        ...pick(p2?.[1]).map((x) => ({ ...x, status: 'completed' })),
      ],
    }
  }

  // Helper to normalize argument names across model variances
  const norm = (res: Record<string, unknown>): Record<string, unknown> => {
    if (!res || typeof res !== 'object') return defaultArgsFor(toolName)
    const out = { ...res }
    if (toolName === 'read_skill') {
      if (!out['skill_name'] && (out['skillName'] || out['skill'] || out['name'])) {
        out['skill_name'] = out['skillName'] || out['skill'] || out['name']
      }
    } else if (toolName === 'search_skills') {
      if (!out['query'] && (out['q'] || out['keyword'] || out['term'])) {
        out['query'] = out['q'] || out['keyword'] || out['term']
      }
    } else if (toolName === 'shell_exec' || toolName === 'bash' || toolName === 'cmd' || toolName === 'powershell' || toolName === 'terminal_exec') {
      if (!out['command'] && out['cmd']) {
        out['command'] = out['cmd']
      }
    }
    return out
  }

  // Strict parse (after shape repair).
  const strict = tryParse(s)
  if (strict !== null) return norm(strict)

  // 2) quoted-string list form: { "todos": ["a", "b"] } — strict path covers it,
  //    this catches unquoted keys like { todos: ["a","b"], }
  const todosUnquoted = s.match(/"?\btodos"?\s*:\s*\[([\s\S]*?)\]/i)
  if (todosUnquoted) {
    const items = todosUnquoted[1].match(/"([^"]{1,200})"|'([^']{1,200})'/g) ?? []
    const todos = items
      .map((it) => it.slice(1, -1).trim())
      .filter((c) => c.length > 0 && c.toLowerCase() !== 'content')
      .map((c) => ({ content: c, status: 'pending' }))
    if (todos.length > 0) return { todos }
  }

  // 3) Generic repair: unquoted keys → quoted, single → double quotes,
  //    trailing commas removed. Never throws.
  try {
    const repaired = s
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, '$1')
    const v = tryParse(repaired)
    if (v !== null) return norm(v)
  } catch { /* fall through */ }

  // 4) fs path from prose: { path: . } / path=. / path: '.'
  //    Accept an empty value as the workspace root (".") so a bare
  //    {"path":""} still resolves like the screenshots' fs_list leak.
  const pathM = s.match(/"?\bpath"?\s*[:=]\s*["']?([^"'},\n]{0,300})["']?/i)
  if (pathM) {
    const p = pathM[1].trim()
    if (p === '') return { path: '.' }
    return { path: p }
  }
  return defaultArgsFor(toolName)
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s) as unknown
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

/**
 * Extract every tool fence in `text`. `pos` tracks the scan cursor so glued
 * fences resolve individually instead of collapsing into one blob.
 * Empty-args tool calls get their defaults ({path:'.'} / {todos:[]}).
 */
export function extractToolFences(text: string): ToolFence[] {
  if (!text) return []
  const out: ToolFence[] = []
  // Open: 3+ ticks, optional "tool:" prefix, then a known tool name on the
  // same line OR as the first body line; non-greedy body; close: 3+ ticks
  // (may differ from opener count). Built dynamically from TOOL_NAME_PATTERN.
  //
  // Case A (name + args on opener line, then body, then close):
  //   ```read_skill query:"pptx presentation"\n{...}\n```
  //   → group1 = toolName, group2 = args-on-line, group3 = rest of body.
  // Case B (name only on opener line):
  //   ```fs_list\n{...}```
  //   → group1 = toolName, group2 = '', group3 = body.
  // Case C (name on first BODY line, no name on opener):
  //   ```\nfs_list\n{...}```
  //   → group1 = undefined, handled by firstLineRe below.
  const re = new RegExp(
    '`{3,}[ \\t]*(?:tool:)?[ \\t]*(' + TOOL_NAME_PATTERN + ')?([^`\\r\\n]*)\\r?\\n?([\\s\\S]*?)`{3,}',
    'gi'
  )
  const firstLineRe = new RegExp('^\\s*(' + TOOL_NAME_PATTERN + ')\\s*\\r?\\n', 'i')
  let m: RegExpExecArray | null
  let guard = 0
  let scanFrom = 0
  while (guard++ < 64) {
    re.lastIndex = scanFrom
    m = re.exec(text)
    if (m === null) break
    let nameStr = m[1]?.toLowerCase() ?? ''
    // Args glued onto the opener line after the tool name (no braces required).
    const inlineArgs = (m[2] ?? '').trim()
    let body = m[3] ?? ''
    if (!nameStr) {
      // Name on its own first body line (```\nfs_list\n{...}\n```)
      const first = body.match(firstLineRe)
      if (first) {
        nameStr = first[1].toLowerCase()
        body = body.slice(first[0].length)
      } else {
        scanFrom = m.index + m[0].length
        continue // not a tool fence — skip
      }
    }
    // Build the args source: prefer JSON body; fall back to inline same-line args.
    let argsSource = body
    if (inlineArgs) {
      // Prefer a real JSON body when present; otherwise parse the opener-line args.
      const bodyTrim = body.trim()
      const bodyLooksJson = bodyTrim.startsWith('{') && bodyTrim.endsWith('}')
      if (!bodyLooksJson) {
        // Bare key:"value" form → wrap so parseLenientJson can repair/quote keys.
        argsSource = inlineArgs.startsWith('{') ? inlineArgs : `{${inlineArgs}}`
      }
    }
    const args = parseLenientJson(argsSource, nameStr)
    out.push({ toolName: nameStr, args, raw: m[0], index: m.index })
    scanFrom = m.index + m[0].length
    if (scanFrom >= text.length) break
  }
  return out
}

// Suppress unused-type lint (ToolName is exported for consumers who want it)
export type { ToolName }

function defaultArgsFor(toolName?: string): Record<string, unknown> {
  if (toolName === 'fs_list') return { path: '.' }
  if (toolName === 'todo_write') return { todos: [] }
  if (toolName === 'search_skills') return { query: '' }
  if (toolName === 'read_skill') return { skill_name: '' }
  if (toolName === 'invoke_subagent') return { role: 'general', description: '' }
  if (toolName === 'shell_exec' || toolName === 'bash' || toolName === 'cmd' || toolName === 'powershell' || toolName === 'terminal_exec') return { command: 'dir' }
  return {}
}

/** True if the text still contains an unexecuted-looking tool fence. */
export function looksLikeToolFence(text: string): boolean {
  return new RegExp('`{3,}[ \\t]*(?:tool:)?[ \\t]*(' + TOOL_NAME_PATTERN + ')\\b', 'i').test(text)
}

/**
 * True if the text contains bare (unfenced) tool call patterns — emitted by
 * models like Nemotron-3-Nano and Qwen that don't use backtick fences or native
 * tool_calls. Matches:
 *   fs_list {path:"."}
 *   fs_list({path: "."})
 *   <fs_list path=".">
 *   fs_list {"path":"."}
 */
export function looksLikeBareToolCall(text: string): boolean {
  const bare = new RegExp(
    '(?:^|[\\s{(<\\[])(' + TOOL_NAME_PATTERN + ')\\s*(?::|\\(|\\{|\\[|\\b(?:path|query|queries|command|todos|content|code|description)\\b)',
    'im'
  )
  const xmlTag = new RegExp('<(' + TOOL_NAME_PATTERN + ')\\b', 'i')
  return bare.test(text) || xmlTag.test(text) || /<tool_call>/i.test(text)
}

/**
 * Extract bare (unfenced) tool calls from plain text.
 * Handles:
 *   [fs_read {"path":"."}]      — square bracketed style
 *   fs_list {path:"."}          — curly braces inline
 *   fs_list({path: "."})        — function-call style
 *   <fs_list path=".">          — XML tag style
 *   todo_write: a, b            — text list style
 */
export function extractBareToolCalls(text: string): ToolFence[] {
  if (!text) return []
  const out: ToolFence[] = []

  // Pattern 1: [tool_name {args}] or tool_name {args} or tool_name({args})
  const jsonBareRe = new RegExp(
    '(\\[?\\s*)(' + TOOL_NAME_PATTERN + ')\\s*\\(?\\s*(\\{[^}]{0,2000}\\})\\s*\\)?(\\s*\\]?)',
    'gi'
  )
  let m: RegExpExecArray | null
  let guard = 0
  while (guard++ < 64 && (m = jsonBareRe.exec(text)) !== null) {
    const prefix = m[1] || ''
    const toolName = m[2].toLowerCase()
    const argsStr = m[3]
    const suffix = m[4] || ''
    const args = parseLenientJson(argsStr, toolName)
    const raw = m[0]
    out.push({ toolName, args, raw, index: m.index })
  }

  // Pattern 1b: todo_write: item1, item2, item3...
  const todoListRe = /\btodo_write\s*:\s*([^\n\r<]{3,300})/gi
  guard = 0
  while (guard++ < 16 && (m = todoListRe.exec(text)) !== null) {
    const raw = m[0]
    const listStr = m[1]
    const items = listStr
      .split(/[,;→]/)
      .map((s) => s.trim().replace(/^[•\-\*\[\]]/, '').trim())
      .filter((s) => s.length > 1)
    if (items.length > 0) {
      const todos = items.map((content) => ({ content, status: 'pending' }))
      out.push({ toolName: 'todo_write', args: { todos }, raw, index: m.index })
    }
  }

  // Pattern 2: <tool_name attr="val" attr2="val2"> or <tool_name attr: "val"> or <tool_name>...</tool_name>
  const xmlRe = new RegExp(
    '<(' + TOOL_NAME_PATTERN + ')\\s*([^>]{0,500})>([\\s\\S]*?)(?:<\\/\\1>|\\/>|$)',
    'gi'
  )
  guard = 0
  while (guard++ < 64 && (m = xmlRe.exec(text)) !== null) {
    const toolName = m[1].toLowerCase()
    const attrStr = m[2] || ''
    const innerContent = m[3] || ''
    const args: Record<string, unknown> = {}
    // Parse key="value" or key='value' or key: "value" or key=value
    const attrRe = /(\w+)\s*(?:=|:)\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
    let a: RegExpExecArray | null
    while ((a = attrRe.exec(attrStr)) !== null) {
      const val = a[2] ?? a[3] ?? a[4] ?? ''
      if (a[1]) args[a[1]] = val
    }
    if (innerContent.trim() && !args['content']) {
      args['content'] = innerContent.trim()
    }
    if (Object.keys(args).length === 0) Object.assign(args, defaultArgsFor(toolName))
    out.push({ toolName, args, raw: m[0], index: m.index })
  }

  // Pattern 3: <tool_call>...</tool_call> (handles function/parameter, arg_key/arg_value, JSON, or bare tool name)
  const toolCallXmlRe = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi
  guard = 0
  while (guard++ < 64 && (m = toolCallXmlRe.exec(text)) !== null) {
    const raw = m[0]
    const content = m[1].trim()
    let toolName = ''
    let args: Record<string, unknown> = {}

    // Variant A: Spark / XHToken syntax:
    // <tool_call>fs_read<arg_key>path</arg_key><arg_value>D:\path</arg_value></tool_call>
    const sparkMatch = content.match(/^([a-zA-Z0-9_-]+)\s*(?:<arg_key>[\s\S]*)/i)
    if (sparkMatch) {
      toolName = sparkMatch[1].toLowerCase()
      const argPairRe = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi
      let ap: RegExpExecArray | null
      while ((ap = argPairRe.exec(content)) !== null) {
        const k = ap[1].trim()
        const v = ap[2].trim()
        args[k] = v
      }
    }

    // Variant B: Function / parameter XML tags:
    // <function name="fs_read"><parameter name="path">...</parameter></function>
    if (!toolName) {
      const fnMatch = /<function(?:>|\s+name=["']?([^>]+?)["']?>)([\s\S]*?)<\/?function>|<function=([^>]+)>/i.exec(content)
      if (fnMatch) {
        toolName = fnMatch[1] || fnMatch[3]
        if (!toolName && fnMatch[2]) {
          toolName = fnMatch[2].replace(/<[^>]+>[\s\S]*/, '').trim()
        }
        toolName = (toolName || '').toLowerCase()
        const paramRe = /<parameter(?:=|\s+name=["'])([^>]+?)(?:["']|)?>([\s\S]*?)(?:<\/parameter>|$)/gi
        let p: RegExpExecArray | null
        while ((p = paramRe.exec(content)) !== null) {
          args[p[1].trim()] = p[2].trim()
        }
        if (Object.keys(args).length === 0) {
          const rawParam = /<parameter>([\s\S]*?)(?:<\/parameter>|$)/i.exec(content)
          if (rawParam) args['content'] = rawParam[1].trim()
        }
      }
    }

    // Variant C: JSON inside <tool_call>:
    // <tool_call>\n{"name": "fs_read", "arguments": {"path": "..."}}\n</tool_call>
    // or <tool_call>{"path": "..."}</tool_call>
    if (!toolName) {
      const jsonStart = content.indexOf('{')
      const jsonEnd = content.lastIndexOf('}')
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const leading = content.slice(0, jsonStart).trim()
        const jsonStr = content.slice(jsonStart, jsonEnd + 1)
        const parsed = tryParse(jsonStr)
        if (parsed) {
          if (parsed['name'] && typeof parsed['name'] === 'string') {
            toolName = (parsed['name'] as string).toLowerCase()
            const rawArgs = parsed['arguments'] || parsed['args'] || parsed['parameters']
            if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
              args = rawArgs as Record<string, unknown>
            } else if (typeof rawArgs === 'string') {
              args = parseLenientJson(rawArgs, toolName)
            }
          } else if (leading && TOOL_NAMES.includes(leading.toLowerCase() as any)) {
            toolName = leading.toLowerCase()
            args = parsed
          }
        }
      }
    }

    // Variant D: Bare name followed by key-value or path inside <tool_call>:
    // <tool_call>fs_read path="D:\..."</tool_call> or <tool_call>fs_list</tool_call>
    if (!toolName) {
      const bareMatch = content.match(/^([a-zA-Z0-9_-]+)([\s\S]*)$/)
      if (bareMatch) {
        const cand = bareMatch[1].toLowerCase()
        if (TOOL_NAMES.includes(cand as any)) {
          toolName = cand
          const rest = bareMatch[2]?.trim() || ''
          if (rest) {
            args = parseLenientJson(rest, toolName)
          }
        }
      }
    }

    if (toolName) {
      if (Object.keys(args).length === 0) Object.assign(args, defaultArgsFor(toolName))
      out.push({ toolName, args, raw, index: m.index })
    }
  }

  // Pattern 4: <invoke name="tool_name">...</invoke>
  const invokeXmlRe = /<invoke\s+name=["']?([^"'>]+)["']?>([\s\S]*?)(?:<\/invoke>|$)/gi
  guard = 0
  while (guard++ < 64 && (m = invokeXmlRe.exec(text)) !== null) {
    const raw = m[0]
    const toolName = m[1].toLowerCase()
    const content = m[2]
    const args: Record<string, unknown> = {}
    const paramRe = /<parameter(?:=|\s+name=["'])([^>]+?)(?:["']|)?>([\s\S]*?)(?:<\/parameter>|$)/gi
    let p: RegExpExecArray | null
    while ((p = paramRe.exec(content)) !== null) {
      args[p[1].trim()] = p[2].trim()
    }
    if (Object.keys(args).length === 0) {
      const jsonStart = content.indexOf('{')
      const jsonEnd = content.lastIndexOf('}')
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = tryParse(content.slice(jsonStart, jsonEnd + 1))
        if (parsed) Object.assign(args, parsed)
      }
    }
    if (Object.keys(args).length === 0) Object.assign(args, defaultArgsFor(toolName))
    out.push({ toolName, args, raw, index: m.index })
  }

  return out
}

/**
 * Parse the legacy JSON tool envelope emitted by some local models:
 * `{ "thought": "...", "action": "shell_exec", "tool_call": { ... } }`.
 * It is an execution instruction, not a user-facing JSON artifact.
 */
export function extractJsonToolCalls(text: string): ToolFence[] {
  if (!text) return []
  const out: ToolFence[] = []
  const re = /```(?:json(?::[a-z0-9_-]+|[-_][a-z0-9_-]+)?|data\.json)[ \t]*\r?\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  let guard = 0
  while (guard++ < 32 && (match = re.exec(text)) !== null) {
    const parsed = tryParse(match[1]?.trim() ?? '')
    if (!parsed) continue

    const actionValue = parsed['action'] ?? parsed['tool'] ?? parsed['tool_name'] ?? parsed['name']
    const callValue = parsed['tool_call'] ?? parsed['call'] ?? parsed['arguments'] ?? parsed['args']
    let toolName = typeof actionValue === 'string' ? actionValue.trim().toLowerCase() : ''
    let args: Record<string, unknown> = {}

    if (callValue && typeof callValue === 'object' && !Array.isArray(callValue)) {
      const call = callValue as Record<string, unknown>
      if (!toolName && typeof call['name'] === 'string') toolName = String(call['name']).trim().toLowerCase()
      const rawArgs = call['arguments'] ?? call['args'] ?? call['input'] ?? call
      if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) args = parseLenientJson(JSON.stringify(rawArgs), toolName)
      else if (typeof rawArgs === 'string') args = parseLenientJson(rawArgs, toolName)
    } else if (typeof callValue === 'string') {
      args = parseLenientJson(callValue, toolName)
    }

    if (!toolName) continue
    if (!TOOL_NAMES.includes(toolName as (typeof TOOL_NAMES)[number]) && !toolName.startsWith('mcp_')) continue
    if (Object.keys(args).length === 0) args = defaultArgsFor(toolName)
    out.push({ toolName, args, raw: match[0], index: match.index })
  }
  return out
}

/** Remove only JSON envelopes that contain an executable tool call. */
export function stripJsonToolCallEnvelopes(text: string): string {
  const calls = extractJsonToolCalls(text)
  if (calls.length === 0) return text
  let out = text
  for (const call of [...calls].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, call.index) + out.slice(call.index + call.raw.length)
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Strip bare tool calls from text (same as stripToolFences but for bare calls).
 */
export function stripBareToolCalls(text: string): string {
  const calls = extractBareToolCalls(text)
  let out = text
  if (calls.length > 0) {
    const sorted = [...calls].sort((a, b) => b.index - a.index)
    for (const f of sorted) {
      out = out.slice(0, f.index) + out.slice(f.index + f.raw.length)
    }
  }
  out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
  out = out.replace(/<\/?tool_call>/gi, '')
  out = out.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/gi, '')
  out = out.replace(/<\/?invoke[^>]*>/gi, '')
  out = out.replace(/<\/?arg_key>[\s\S]*?<\/arg_key>/gi, '')
  out = out.replace(/<\/?arg_value>[\s\S]*?<\/arg_value>/gi, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Remove every tool fence (by span) from the text. Cheap: sort spans, splice.
 * Used so the user never sees raw ```tool: markdown in the bubble.
 */
export function stripToolFences(text: string): string {
  const fences = extractToolFences(text)
  if (fences.length === 0) return text
  let out = text
  // Replace from the end so earlier indices stay valid.
  const sorted = [...fences].sort((a, b) => b.index - a.index)
  for (const f of sorted) {
    const start = f.index
    const end = f.index + f.raw.length
    out = out.slice(0, start) + out.slice(end)
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
