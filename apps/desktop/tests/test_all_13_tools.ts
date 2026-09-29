import fs from 'node:fs'
import path from 'node:path'
import { ToolStubAdapter, createWebRuntime } from '../src/main/backend/ports/ToolStubAdapter'

process.env.SOVARA_NETWORK_MODE = 'CONTROLLED_LOCAL'
const WORKSPACE = 'D:\\SOVARA'

async function runToolAudit() {
  console.log('======================================================================')
  console.log('SOVARA ALL 13+ TOOLS EXECUTION AUDIT')
  console.log(`Workspace: ${WORKSPACE}`)
  console.log('======================================================================\n')

  const webRuntime = createWebRuntime(() => true)
  const adapter = new ToolStubAdapter(
    webRuntime,
    () => [], // mcp servers
    () => WORKSPACE,
    {
      dispatch: (input) => {
        return {
          jobId: `job_${Date.now()}`,
          done: Promise.resolve({ status: 'completed', result: `Subagent completed: ${input.description}`, durationMs: 42 })
        }
      }
    },
    true // allow all
  )

  const toolTests = [
    {
      num: 1,
      name: 'fs_list',
      args: { path: '.' },
      desc: 'List workspace directory entries'
    },
    {
      num: 2,
      name: 'fs_read',
      args: { path: 'package.json', start_line: 1, end_line: 10 },
      desc: 'Read lines 1-10 of package.json'
    },
    {
      num: 3,
      name: 'fs_write',
      args: { path: 'test_audit_file.txt', content: 'SOVARA Tool Execution Verification\nInitial Content' },
      desc: 'Create or overwrite a file in workspace'
    },
    {
      num: 4,
      name: 'fs_patch',
      args: { path: 'test_audit_file.txt', search: 'Initial Content', replace: 'Patched Content: Verified' },
      desc: 'Apply surgical search-and-replace to file'
    },
    {
      num: 5,
      name: 'fs_search',
      args: { path: '.', query: '@sovara/desktop' },
      desc: 'Search codebase for string query'
    },
    {
      num: 6,
      name: 'shell_exec',
      args: { command: 'node -v' },
      desc: 'Execute shell command in workspace'
    },
    {
      num: 7,
      name: 'list_dev_servers',
      args: {},
      desc: 'List background dev servers'
    },
    {
      num: 8,
      name: 'stop_dev_server',
      args: { port: 99999 },
      desc: 'Stop background dev server by port'
    },
    {
      num: 9,
      name: 'todo_write',
      args: {
        todos: [
          { content: 'Verify all 13 SOVARA tools live', status: 'completed' },
          { content: 'Generate raw outputs report', status: 'in_progress' }
        ]
      },
      desc: 'Save and update structured task list'
    },
    {
      num: 10,
      name: 'memory',
      args: {
        action: 'store',
        title: 'ToolAuditVerification',
        type: 'concept',
        body: 'Comprehensive live verification of all 13 SOVARA tools.',
        tags: ['audit', 'tools', 'verification']
      },
      desc: 'Store durable fact to wiki knowledge graph'
    },
    {
      num: 11,
      name: 'search_skills',
      args: { query: 'arena' },
      desc: 'Search available enterprise skills'
    },
    {
      num: 12,
      name: 'read_skill',
      args: { skill_name: 'arena' },
      desc: 'Read full skill instructions from disk'
    },
    {
      num: 13,
      name: 'web_search',
      args: { queries: ['site:github.com SOVARA sovereign AI'] },
      desc: 'Live web search via DuckDuckGo engine'
    },
    {
      num: 14,
      name: 'web_fetch',
      args: { urls: ['https://example.com'] },
      desc: 'Fetch and parse webpage content to markdown'
    },
    {
      num: 15,
      name: 'invoke_subagent',
      args: { role: 'explore', description: 'Analyze codebase entry points' },
      desc: 'Delegate task to background subagent'
    }
  ]

  const results: Array<{
    num: number
    name: string
    desc: string
    args: any
    status: 'SUCCESS' | 'ERROR'
    durationMs: number
    rawOutput: string
    parsedOutput: any
  }> = []

  for (const t of toolTests) {
    console.log(`[Tool ${t.num}/15] Executing: ${t.name}...`)
    const t0 = Date.now()
    let rawOutput = ''
    let status: 'SUCCESS' | 'ERROR' = 'SUCCESS'

    try {
      rawOutput = await adapter.dispatch(t.name, t.args)
    } catch (err: any) {
      status = 'ERROR'
      rawOutput = `Exception: ${err.message}`
    }

    const durationMs = Date.now() - t0
    let parsedOutput: any = null
    try {
      parsedOutput = JSON.parse(rawOutput)
      if (parsedOutput.error && !t.name.includes('stop_dev_server')) {
        // stop_dev_server on port 99999 returns not found which is expected
        status = 'ERROR'
      }
    } catch {
      parsedOutput = rawOutput
    }

    console.log(` -> Status: ${status} (${durationMs}ms)`)
    console.log(` -> Preview: ${rawOutput.slice(0, 120).replace(/\n/g, ' ')}...\n`)

    results.push({
      num: t.num,
      name: t.name,
      desc: t.desc,
      args: t.args,
      status,
      durationMs,
      rawOutput,
      parsedOutput
    })
  }

  // Clean up temporary test file
  try {
    fs.unlinkSync(path.join(WORKSPACE, 'test_audit_file.txt'))
  } catch {}

  // Write JSON artifact
  const jsonPath = path.join(WORKSPACE, 'tool_execution_results.json')
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`Saved JSON results to ${jsonPath}`)

  // Write Markdown artifact
  let md = '# SOVARA All 15 Defined Tools — Live Execution Audit\n\n'
  md += `**Execution Time**: ${new Date().toISOString()}\n`
  md += `**Workspace**: \`${WORKSPACE}\`\n\n`
  md += `| # | Tool Name | Purpose | Status | Latency | Result Summary |\n`
  md += `|---|---|---|---|---|---|\n`

  for (const r of results) {
    const summary = r.rawOutput.slice(0, 80).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|')
    md += `| ${r.num} | \`${r.name}\` | ${r.desc} | **${r.status}** | ${r.durationMs}ms | ${summary}... |\n`
  }

  md += '\n\n---\n\n## Detailed Raw Tool Outputs\n\n'

  for (const r of results) {
    md += `### ${r.num}. \`${r.name}\`\n`
    md += `* **Purpose**: ${r.desc}\n`
    md += `* **Input Arguments**:\n\`\`\`json\n${JSON.stringify(r.args, null, 2)}\n\`\`\`\n`
    md += `* **Status**: **${r.status}** (${r.durationMs}ms)\n`
    md += `* **Actual Output Received**:\n\`\`\`${r.name.includes('web') || r.name === 'shell_exec' ? 'text' : 'json'}\n${r.rawOutput}\n\`\`\`\n\n`
  }

  const mdPath = path.join(WORKSPACE, 'tool_execution_results.md')
  fs.writeFileSync(mdPath, md, 'utf8')
  console.log(`Saved Markdown results to ${mdPath}`)
}

runToolAudit().catch((err) => {
  console.error('Fatal audit error:', err)
  process.exit(1)
})
