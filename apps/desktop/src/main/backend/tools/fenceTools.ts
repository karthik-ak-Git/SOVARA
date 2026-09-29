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

export interface NormalizedToolCall {
  type: 'tool_call'
  tool: string
  arguments: Record<string, unknown>
  rawCallId?: string
  rawSpan?: string
  index?: number
}

export function toNormalizedToolCall(fence: ToolFence): NormalizedToolCall {
  return {
    type: 'tool_call',
    tool: normalizeToolName(fence.toolName),
    arguments: { ...fence.args },
    rawSpan: fence.raw,
    index: fence.index,
  }
}

export function extractNormalizedToolCalls(text: string): NormalizedToolCall[] {
  const fences = extractToolFences(text)
  return fences.map(toNormalizedToolCall)
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

export function normalizeToolName(name: string): string {
  const clean = (name || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '')
  if (clean === 'fswrite' || clean === 'fs_write') return 'fs_write'
  if (clean === 'fsread' || clean === 'fs_read') return 'fs_read'
  if (clean === 'fslist' || clean === 'fs_list') return 'fs_list'
  if (clean === 'fspatch' || clean === 'fs_patch') return 'fs_patch'
  if (clean === 'fssearch' || clean === 'fs_search') return 'fs_search'
  if (clean === 'shellexec' || clean === 'shell_exec') return 'shell_exec'
  if (clean === 'todowrite' || clean === 'todo_write') return 'todo_write'
  if (clean === 'searchskills' || clean === 'search_skills') return 'search_skills'
  if (clean === 'readskill' || clean === 'read_skill') return 'read_skill'
  if (clean === 'websearch' || clean === 'web_search') return 'web_search'
  if (clean === 'webfetch' || clean === 'web_fetch') return 'web_fetch'
  if (clean === 'invokesubagent' || clean === 'invoke_subagent') return 'invoke_subagent'
  if (clean === 'runcode' || clean === 'run_code') return 'run_code'
  return clean
}


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
      const alias = out['skillName'] || out['skill'] || out['name'] || out['path'] || out['query']
      if (!out['skill_name'] && alias) {
        out['skill_name'] = alias
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
/**
 * Parse the XML/arg-tag tool-call dialect that local models actually emit.
 *
 * Measured live against Spark-X2.5-4B on the app's own sidecar, same prompt,
 * temperature 0.2, three consecutive runs:
 *     fences parsed: 18, 0, 1     xml form: no, YES, no
 * The model flip-flops between the ```tool:name fence the prompt asks for and
 * an arg-tag form the parser could not read at all. When it chose the arg-tag
 * form the turn produced ZERO tool calls and the agent loop died - which is the
 * 32-step, 20-completion-token failure recorded in the app's own chat.log.
 *
 * So the parser accepts both dialects instead of insisting on one. This is not
 * a special case for one model: every instruct-tuned checkpoint carries
 * tool-call syntax from its own training, and a router that only understands
 * one dialect is fragile against all of them.
 *
 * Shapes handled:
 *   <tool_call>name<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>
 *   <tool_call>{"name":"x","arguments":{...}}</tool_call>
 *   <|tool_call_begin|><|tool_sep|>name<|tool_call_end|>
 * Zero-width and BOM characters are stripped first, because they appear
 * INSIDE the tag names and defeat any literal match.
 */
function extractXmlToolCalls(raw: string): ToolFence[] {
  // U+200B/200C/200D, U+FEFF and soft hyphen are invisible but were observed
  // inside the emitted tag names.
  const text = raw.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
  // The guard must accept the `<|...|>` ChatML prefix as well as a bare `<`.
  // Without the optional `|` here, `<|tool_call_begin|>` never matches and the
  // entire ChatML form below is unreachable.
  if (!/<\s*\|?\s*\/?\s*(?:tool_call|tool\b|function\b|function_calls|tool_calls)/i.test(text)) return []

  const out: ToolFence[] = []

  // Form 1: arg_key / arg_value pairs.
  const pairsRe = /<\s*tool_call\s*>([\s\S]*?)<\s*\/\s*tool_call\s*>/gi
  let m: RegExpExecArray | null
  while ((m = pairsRe.exec(text)) !== null) {
    const inner = m[1] ?? ''
    const nameM = /<\s*tool_name\s*>\s*([\s\S]*?)\s*<\s*\/\s*tool_name\s*>/i.exec(inner)
      ?? /^\s*([A-Za-z_][\w.-]*)/.exec(inner)
    if (!nameM) continue
    const tool = (nameM[1] ?? '').trim()
    if (!tool) continue
    const args: Record<string, unknown> = {}
    const kv = /<\s*arg_key\s*>\s*([\s\S]*?)\s*<\s*\/\s*arg_key\s*>\s*<\s*arg_value\s*>\s*([\s\S]*?)\s*<\s*\/\s*arg_value\s*>/gi
    let p: RegExpExecArray | null
    while ((p = kv.exec(inner)) !== null) {
      const k = (p[1] ?? '').trim()
      if (k) args[k] = coerce((p[2] ?? '').trim())
    }
    out.push({ toolName: tool, args, raw: m[0]!, index: m.index })
  }
  if (out.length) return out

  // Form 2: a JSON payload inside the tag pair.
  const jsonRe = /<\s*tool_call\s*>([\s\S]*?)<\s*\/\s*tool_call\s*>/gi
  while ((m = jsonRe.exec(text)) !== null) {
    const body = (m[1] ?? '').trim()
    if (!body.startsWith('{')) continue
    try {
      const j = JSON.parse(body) as { name?: string; tool?: string; arguments?: unknown; parameters?: unknown; args?: unknown }
      const tool = (j.name ?? j.tool ?? '').toString().trim()
      if (!tool) continue
      const a = (j.arguments ?? j.parameters ?? j.args ?? {}) as Record<string, unknown>
      out.push({ toolName: tool, args: a && typeof a === 'object' ? a : {}, raw: m[0]!, index: m.index })
    } catch { /* not JSON, ignore */ }
  }
  if (out.length) return out

  // Form 3: ChatML-ish separators. The argument JSON follows tool_call_end
  // rather than sitting inside the pair, e.g.
  //   <|tool_call_begin|><|tool_sep|>fs_read<|tool_call_end|>{"path":"a.txt"}
  const sepRe = /<\s*\|?\s*tool_call_begin\s*\|?\s*>([\s\S]*?)<\s*\|?\s*tool_call_end\s*\|?\s*>([\s\S]*?)(?:<\s*\|?\s*(?:tool_call_end|tool_call_begin|tool_sep|eos_token)\s*\|?\s*>|$)/gi
  while ((m = sepRe.exec(text)) !== null) {
    // tool_sep is the ONLY thing separating the tag from the name, so it turns
    // into a leading newline and the name lands in the NEXT segment.
    const marked = (m[1] ?? '').replace(/<\s*\|?\s*tool_sep\s*\|?\s*>/i, '\n')
    const segs = marked.split('\n')
    let tool = (segs[0] ?? '').trim()
    let inline = segs.slice(1).join('\n').trim()
    if (!tool && segs.length > 1) {
      tool = (segs[1] ?? '').trim()
      inline = segs.slice(2).join('\n').trim()
    }
    if (!tool) continue
    const trailing = (m[2] ?? '').trim()
    const rest = trailing || inline
    let args: Record<string, unknown> = {}
    if (rest.startsWith('{')) { try { args = JSON.parse(rest) } catch { args = {} } }
    else {
      const kv = /(\w+)\s*=\s*"?([^"\n]*)"?/g
      let q: RegExpExecArray | null
      while ((q = kv.exec(rest)) !== null) args[q[1]!] = coerce((q[2] ?? '').trim())
    }
    out.push({ toolName: tool, args, raw: m[0]!, index: m.index })
  }
  return out
}

/** Best-effort typing of loose arg values: JSON if it parses, else the string. */
function coerce(v: string): unknown {
  if (v === '') return ''
  if (/^(true|false|null)$/i.test(v)) return v.toLowerCase() === 'true' ? true : v.toLowerCase() === 'false' ? false : null
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try { return JSON.parse(v) } catch { return v }
  }
  return v
}

export function extractToolFences(text: string): ToolFence[] {
  if (!text) return []
  const out: ToolFence[] = []
  // Accept whichever dialect the model chose this turn. Fence form is tried
  // first because it is the form the prompt requests; the XML/arg-tag dialect
  // is the fallback the model falls back to under prompt load.
  const xml = extractXmlToolCalls(text)
  if (xml.length) return xml
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
    if (nameStr === 'fs_write' && (!args['content'] || typeof args['content'] !== 'string' || (args['content'] as string).trim() === '')) {
      const codeMatch = /```(?:html|css|js|javascript|ts|typescript|py|python|json|sh|bash|powershell)?\s*\n([\s\S]+?)\n```/i.exec(text)
      if (codeMatch && codeMatch[1]?.trim()) {
        args['content'] = codeMatch[1].trim()
      }
    }
    if (['shell_exec', 'bash', 'cmd', 'powershell', 'terminal_exec'].includes(nameStr)) {
      if (!args['command'] && args['cmd']) args['command'] = args['cmd']
      if (!args['command'] && args['script']) args['command'] = args['script']
    }
    const reqArgs = ['fs_write', 'fs_patch', 'fs_read', 'shell_exec', 'bash', 'cmd', 'powershell', 'terminal_exec', 'search_skills', 'read_skill', 'invoke_subagent'].includes(nameStr)
    if (!reqArgs || Object.keys(args).length > 0) {
      out.push({ toolName: nameStr, args, raw: m[0], index: m.index })
    }
    scanFrom = m.index + m[0].length
    if (scanFrom >= text.length) break
    // Glued-fence recovery. The closing run is `` `{3,} `` (greedy), so a
    // model that glued two calls as ```tool:a … ```tool:b … ``` (6 ticks at
    // the seam) has ALL of those ticks swallowed by our closer, and call `b`
    // then looks like bare text and is silently dropped. If the match ends on
    // more than 3 ticks, hand the surplus back so the next iteration can open
    // the following fence.
    const trailing = /`+$/.exec(m[0])?.[0].length ?? 0
    if (trailing > 3) {
      const rewindTo = m.index + m[0].length - (trailing - 3)
      const tail = text.slice(rewindTo)
      if (new RegExp('^`{3,}[ \\t]*(?:tool:)?[ \\t]*(' + TOOL_NAME_PATTERN + ')', 'i').test(tail)) {
        scanFrom = rewindTo
      }
    }
  }
  if (out.length === 0) {
    const bare = extractBareToolCalls(text)
    if (bare.length) return bare
  }
  return out
}

// Suppress unused-type lint (ToolName is exported for consumers who want it)
export type { ToolName }

function defaultArgsFor(toolName?: string): Record<string, unknown> {
  if (toolName === 'fs_list') return { path: '.' }
  if (toolName === 'todo_write') return { todos: [] }
  if (toolName === 'search_skills') return {}
  if (toolName === 'read_skill') return {}
  if (toolName === 'invoke_subagent') return { role: 'general', description: '' }
  if (toolName === 'shell_exec' || toolName === 'bash' || toolName === 'cmd' || toolName === 'powershell' || toolName === 'terminal_exec') return {}
  return {}
}

/** True if the text still contains an unexecuted-looking tool fence. */
export function looksLikeToolFence(text: string): boolean {
  if (!text) return false
  const backtickFence = new RegExp('`{3,}[ \\t]*(?:tool:)?[ \\t]*(' + TOOL_NAME_PATTERN + ')\\b', 'i').test(text)
  return backtickFence || looksLikeBareToolCall(text)
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

  // Pattern 0: Bare JSON objects in text (explicit action/tool or implicit by key signature):
  // e.g. { "action": "fs_write", "path": "...", "content": "..." }
  // e.g. { "path": "revenue.py", "content": "...", "status": "pending" } -> fs_write
  // e.g. { "command": "python revenue.py", "status": "pending" } -> shell_exec
  const jsonObjectStartRe = /\{\s*"(?:tool_calls|tool_call|calls|call|action|tool|name|tool_name|function|path|command|cmd|query|skill_name)"\s*:/gi
  let mObj: RegExpExecArray | null
  let guardObj = 0
  while (guardObj++ < 32 && (mObj = jsonObjectStartRe.exec(text)) !== null) {
    const startIdx = mObj.index
    jsonObjectStartRe.lastIndex = startIdx + mObj[0].length

    let braceCount = 0
    let endIdx = -1
    for (let i = startIdx; i < text.length; i++) {
      if (text[i] === '{') braceCount++
      else if (text[i] === '}') {
        braceCount--
        if (braceCount === 0) {
          endIdx = i
          break
        }
      }
    }
    if (endIdx > startIdx) {
      const fullJson = text.slice(startIdx, endIdx + 1)
      const parsed = tryParse(fullJson)
      if (parsed && typeof parsed === 'object') {
        const rawCallsArray = (parsed['tool_calls'] || parsed['tool_call'] || parsed['calls'])
        const callItems: Array<Record<string, unknown>> = Array.isArray(rawCallsArray)
          ? (rawCallsArray as Array<Record<string, unknown>>)
          : [parsed as Record<string, unknown>]

        for (const item of callItems) {
          if (!item || typeof item !== 'object') continue
          let toolName = ''
          const rawAction = (item['call'] || item['action'] || item['tool'] || item['name'] || item['tool_name'] || item['function'])
          if (typeof rawAction === 'string') {
            toolName = normalizeToolName(rawAction)
          }
          if (!toolName || !TOOL_NAMES.includes(toolName as any)) {
            if (typeof item['command'] === 'string' || typeof item['cmd'] === 'string') {
              toolName = 'shell_exec'
            } else if (typeof item['path'] === 'string' && typeof item['content'] === 'string') {
              toolName = 'fs_write'
            } else if (typeof item['path'] === 'string' && typeof item['search'] === 'string' && typeof item['replace'] === 'string') {
              toolName = 'fs_patch'
            } else if (typeof item['path'] === 'string') {
              toolName = 'fs_read'
            } else if (typeof item['skill_name'] === 'string') {
              toolName = 'read_skill'
            } else if (typeof item['query'] === 'string') {
              toolName = 'search_skills'
            }
          }
          if (toolName && TOOL_NAMES.includes(toolName as any)) {
            let args: Record<string, unknown> = {}
            const rawArgs = item['arguments'] ?? item['args'] ?? item['parameters']
            if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
              args = rawArgs as Record<string, unknown>
            } else {
              args = { ...item }
              delete args['call']; delete args['action']; delete args['tool']; delete args['name']; delete args['tool_name']; delete args['function']; delete args['status']
            }
            out.push({ toolName, args, raw: fullJson, index: startIdx })
          }
        }
        if (callItems.length > 0 && out.length > 0) {
          jsonObjectStartRe.lastIndex = endIdx + 1
        }
      }
    }
  }
  if (out.length > 0) return out

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
    if (Object.keys(args).length === 0) return out
    out.push({ toolName, args, raw: m[0], index: m.index })
  }

  // Pattern 3: <tool_call>...</tool_call> or <|tool_call|> (handles function/parameter, arg_key/arg_value, JSON, or bare tool name)
  const toolCallXmlRe = /<\s*\|?\s*tool_call\s*\|?>([\s\S]*?)(?:<\s*\|?\s*\/?\s*tool_call\s*\|?>|$)/gi
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
    // or <tool_call>call:fs_write{"path": "..."}</tool_call>
    // or <tool_call>{"path": "..."}</tool_call>
    if (!toolName) {
      const jsonStart = content.indexOf('{')
      const jsonEnd = content.lastIndexOf('}')
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const leading = content.slice(0, jsonStart).trim()
        const cleanLeading = leading.replace(/^(?:call:|tool:)/i, '').trim().toLowerCase()
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
          } else if (cleanLeading && TOOL_NAMES.includes(cleanLeading as any)) {
            toolName = cleanLeading
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
      if (Object.keys(args).length === 0) continue
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
    if (Object.keys(args).length === 0) continue
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
    if (!parsed || typeof parsed !== 'object') continue

    const rawCallsArray = parsed['tool_calls'] || parsed['tool_call'] || parsed['calls']
    const callItems: Array<Record<string, unknown>> = Array.isArray(rawCallsArray)
      ? (rawCallsArray as Array<Record<string, unknown>>)
      : [parsed as Record<string, unknown>]

    for (const item of callItems) {
      if (!item || typeof item !== 'object') continue
      const actionValue = item['action'] ?? item['tool'] ?? item['tool_name'] ?? item['name'] ?? item['call']
      let toolName = typeof actionValue === 'string' ? normalizeToolName(actionValue) : ''
      let args: Record<string, unknown> = {}

      const argsValue = item['arguments'] ?? item['args'] ?? item['parameters'] ?? item['input'] ?? (item['tool_call'] && typeof item['tool_call'] === 'object' ? item['tool_call'] : undefined)
      if (argsValue && typeof argsValue === 'object' && !Array.isArray(argsValue)) {
        args = argsValue as Record<string, unknown>
      } else if (typeof argsValue === 'string') {
        args = parseLenientJson(argsValue, toolName)
      } else {
        const copy = { ...item }
        delete copy['call']; delete copy['action']; delete copy['tool']; delete copy['name']; delete copy['tool_name']; delete copy['function']; delete copy['status']; delete copy['thought']; delete copy['tool_call']
        args = copy
      }

      if (!toolName) continue
      if (!TOOL_NAMES.includes(toolName as (typeof TOOL_NAMES)[number]) && !toolName.startsWith('mcp_')) continue
      if (Object.keys(args).length === 0) continue
      out.push({ toolName, args, raw: match[0], index: match.index })
    }
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
