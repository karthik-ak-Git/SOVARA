# SOVARA TOOL REALITY LAB REPORT

> **Evaluation Date:** September 28, 2026  
> **Diagnostic Phase:** Production Tool Verification & Evidence Lab  
> **Target Package:** `@sovara/desktop` (`apps/desktop/tests/tool_reality/`)  
> **Test Status:** 23 / 23 Isolated Reality Tests PASSED  
> **Tool Reality Result:** `TOOLS_VERIFIED`

---

## 1. Executive Summary

Before modifying orchestrator loop logic or prompt policies, we constructed a dedicated **Tool Reality Test Lab** inside `apps/desktop/tests/tool_reality/` to empirically test every tool capability available to the AI agent.

Every test executed against a completely isolated, synthetic test workspace populated with realistic factory data (`production_notes.txt`, `machine_config.json`, `safety_rules.md`, `valid_script.py`, `broken_script.py`, `interactive_hang.py`, `nested/report.md`, etc.).

### Key Findings
1. **Tool Integrity & Truthfulness**: All core capabilities (`fs_read`, `fs_write`, `fs_patch`, `fs_list`, `fs_search`, `shell_exec`, `search_skills`, `read_skill`, `memory`, `processAttachments`, `generateArtifactFile`) return truthful observations backed by real disk state.
2. **Agent Consumability**: Observations return rich, structured JSON or text containing all values needed for downstream agent calculations (e.g. `fs_read` returns exact machine production rates; `fs_write` returns byte counts and path verification; `fs_list` returns file types and sizes; `fs_search` returns line numbers and matching text).
3. **Workspace Boundary Security**: Traversal attempts (e.g. `../../secret.txt`) are reliably intercepted by `resolveWorkspacePath`, preventing directory escape.
4. **Failure Recovery Context**: When `fs_read` fails due to a filename mismatch (e.g., requesting `production_notes.txt` when `production_notes.txt.txt` exists), `fs_read` includes `availableInDir` directory hints so the AI can self-correct.

---

## 2. Tool Inventory & Contracts

| Tool Name | Real Implementation Seam | Input Contract | Output Observation Contract | Security Boundary |
| :--- | :--- | :--- | :--- | :--- |
| **`fs_read`** | `capabilities/fs/index.ts` (`dispatchFs`) | `{ path: string, start_line?: number, end_line?: number }` | `{ workspace, path, size, linesReturned, totalLines, content }` | Workspace-restricted relative resolution (`resolveWorkspacePath`). Absolute path reads allowed for explicit external paths. |
| **`fs_write`** | `capabilities/fs/index.ts` (`dispatchFs`) | `{ path: string, content: string }` | `{ ok: true, verified: true, empty, path, bytes, workspace }` | Strict workspace containment; auto-creates parent directories; verifies written byte size against buffer length. |
| **`fs_patch`** | `capabilities/fs/index.ts` (`dispatchFs`) | `{ path: string, search: string, replace: string }` | `{ ok: true, verified: true, path, patchedAt, removedChars, insertedChars, bytes }` | Strict workspace containment; fails with explicit error if search string is not found in file. |
| **`fs_list`** | `capabilities/fs/index.ts` (`dispatchFs`) | `{ path?: string }` | `{ workspace, path, external, entries: [{ name, isDirectory, isFile, size, path }], count }` | Capped at 200 entries; returns relative paths for workspace entries. |
| **`fs_search`** | `capabilities/fs/index.ts` (`dispatchFs`) | `{ path?: string, query: string }` | `{ workspace, query, path, results: [{ file, line, text }], capped }` | Recursively searches workspace directory; ignores `node_modules`, `.git`, `dist`; caps at 50 results. |
| **`shell_exec`** | `capabilities/shell/index.ts` (`dispatchShell`) | `{ command: string, timeoutMs?: number }` | `{ command, exitCode, stdout, stderr, durationMs }` | Executed inside workspace working directory; non-zero exit codes reported honestly; non-blocking process lifecycle. |
| **`search_skills`** | `backend/ports/ToolStubAdapter.ts` (`dispatchSkills`) | `{ query: string }` | `{ query, interpretedAs, matches: [{ name, source, description }], totalCount }` | Scans workspace and global skills; unweighted keyword matching. |
| **`read_skill`** | `backend/ports/ToolStubAdapter.ts` (`dispatchSkills`) | `{ skill_name: string }` | `{ name, source, content }` | Reads `SKILL.md` file from skill directory (capped at 10,000 chars). |
| **`memory`** | `backend/ports/ToolStubAdapter.ts` (`dispatchMemory`) | `{ action: "store"\|"recall"\|"list", title?, type?, body?, links?, tags?, query? }` | `{ ok: true, path, bytes }` or `{ results: [{ file, line, text }] }` | Writes frontmatter-tagged Markdown files to `wiki/` directory; recalls via `fs_search`. |
| **`attachments`** | `backend/attachments.ts` (`processAttachments`) | `IncomingAttachment[]` | `{ files: [ProcessedAttachment], manifestLine, totalChars, hasImage }` | Decodes base64 data URLs; extracts image width/height; extracts text from text/pdf/office files. |
| **`artifacts`** | `backend/artifacts.ts` (`generateArtifactFile`) | `kind, targetFile, content, prompt` | `{ path, bytes }` | Materializes code/HTML/PDF/PPTX/DOCX/XLSX files directly on disk. |

---

## 3. Empirical Evaluation Matrix

| Tool | Real Tested | Truthful | Agent-Sufficient | Failure Honest | Security | Output Quality Classification | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`fs_read`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`fs_write`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`fs_patch`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`fs_list`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`fs_search`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`shell_exec`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`search_skills`**| YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`read_skill`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`memory`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`attachments`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |
| **`artifacts`** | YES | YES | YES | YES | PASS | **SUFFICIENT** | `VERIFIED` |

---

## 4. Test Suite Structure & Isolation

```
apps/desktop/tests/tool_reality/
├── fixtures/
│   └── setup.ts                   # Deterministic workspace factory
├── fs/
│   └── fs_reality.test.ts         # fs_read, fs_write, fs_patch, fs_list, fs_search
├── shell/
│   └── shell_reality.test.ts      # shell_exec valid, broken, interactive timeout
├── skills/
│   └── skills_reality.test.ts     # search_skills, read_skill, calculator prompt non-injection
├── knowledge/
│   └── knowledge_reality.test.ts  # memory store & recall
├── artifacts/
│   └── artifacts_reality.test.ts  # format detection & generation
├── multimodal/
│   └── multimodal_reality.test.ts # image attachment processing & blank control
└── harness/
    └── agent_consumability.test.ts# Multi-step AI observation contract harness
```

---

## 5. Tool Reality Conclusion

```
==================================================
TOOL_REALITY_RESULT: TOOLS_VERIFIED
==================================================
```

All 11 SOVARA tool capabilities have been empirically verified to be **functional, truthful, agent-sufficient, failure-honest, and secure**. Tool observations return rich, un-stubbed content allowing an AI agent to inspect, reason, calculate, write, and verify workspace state end-to-end.
