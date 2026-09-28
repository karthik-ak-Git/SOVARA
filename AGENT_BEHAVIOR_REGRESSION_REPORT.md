# SOVARA CRITICAL AGENT BEHAVIOR & REGRESSION FIX REPORT

## 1. Executive Summary

This report documents the root-cause diagnosis, engineering fixes, and empirical test verification for critical SOVARA agent behavior issues reported during real-world local model testing.

### Summary of Fixes:
1. **Removed Irrelevant Skill Injection**: Stopped simple calculation and text file tasks from triggering `search_skills({"query":"xlsx"})` and `read_skill({"skill_name":"xlsx"})`.
2. **Enabled Filename Recovery**: Enabled the agent to read directory hints when `fs_read` encounters missing or duplicate extensions (e.g. `production_notes.txt.txt` when `production_notes.txt` was requested).
3. **Prevented Placeholder Artifact Success**: Blocked task completion and artifact creation when source files failed to read, eliminating fake deliverables with text like `"Data is currently unavailable"`.
4. **Made Completion Gates Intent-Aware**: Tailored completion requirements to user prompt intent (read-only, write-only, write-and-verify, or calculation tasks).
5. **Hid Internal Model Reasoning & Directives from UI**: Cleaned raw headers (`Thinking Process:`, `**Analyze the Request**`) and system text markers (`[Jarvis Agent...]`) from assistant message bubbles in chat.
6. **Clean Tool Activity Display**: Ensured tool activity renders as clean status cards driven by canonical event sinks.

---

## 2. Root Cause Analysis & Architectural Fixes

### A. Irrelevant Skill Injection (`xlsx`)
- **Root Cause**:
  1. In `TaskClassifier.ts` (line 44), the regex `xlsx: /\b(xlsx|excel|spreadsheet|calculation|financial|budget)\b/gi` matched common words like `calculation`, `financial`, and `budget`. Prompts asking for arithmetic calculations triggered `skillsNeeded = ['xlsx']` and set `requiresArtifact = true`.
  2. In `sovaraSystem.ts` (lines 79, 88, 159), system instructions blanketly instructed: *"Before writing anything, call search_skills with 'xlsx'..."*
  3. In `AgentOrchestrator.ts` (lines 1296, 3252), mandatory skill directives forced `search_skills` and `read_skill` execution whenever `skillsContext` was present.
- **Fix**:
  - Restricted `xlsx` detection in `TaskClassifier.ts` to explicit spreadsheet keywords: `/\b(xlsx|excel|spreadsheet|\.xlsx)\b/gi`.
  - Updated `sovaraSystem.ts` to restrict `search_skills` strictly to specialized format builds (PPTX presentations, Excel spreadsheets, DOCX documents, PDF exports).
  - Ensured simple arithmetic and standard file tasks use direct reasoning or `fs_read`/`fs_write` directly.

### B. Filename Recovery (`production_notes.txt.txt`)
- **Root Cause**:
  When `fs_read("production_notes.txt")` failed, `capabilities/fs/index.ts` returned `hint: "Files existing in directory: production_notes.txt.txt"`. However, the prompt instructions and orchestrator continuation loop did not direct the model to read the directory hint and retry with the existing filename.
- **Fix**:
  - Updated `tool:read` in `sovaraSystem.ts` with explicit instructions to check the `hint` / `Files existing in directory` list and immediately retry `fs_read` using the matching filename.
  - Added an autonomous directive trigger in `AgentOrchestrator.ts` that detects `fs_read` failures with available file hints and instructs the model to read the matching file.

### C. Placeholder Artifact Prevention
- **Root Cause**:
  When `fs_read` failed, the model generated a markdown file (e.g. `production_summary.md`) containing filler statements like `"Data is currently unavailable"`, and `AgentOrchestrator.ts` accepted the turn as completed because `fs_write` executed.
- **Fix**:
  - Added `NO PLACEHOLDER ARTIFACTS` rule in `sovaraSystem.ts` prohibiting file creation when source data was not read.
  - Added placeholder detection in `AgentOrchestrator.ts` completion gate. If written content contains placeholder phrases (`"Data is currently unavailable"`, `"No data provided"`) while source file read failed, the gate blocks `task:complete` and reports:
    `"source data file read failed; placeholder artifact cannot satisfy request"`.

### D. Intent-Aware Completion Gates
- **Root Cause**:
  The completion gate previously applied generic rules (e.g. requiring `fs_list` / `fs_read` for write-only tasks or allowing completion without requested verification).
- **Fix**:
  - `isWriteOnlyTask`: User asked to create/write a file (e.g. "Create file test.md"). `fs_write` is sufficient; inspection is not required.
  - `isReadOnlyTask`: User asked to read/summarize a file. `fs_read` + summary is sufficient.
  - `isWriteAndVerifyTask`: User asked to create a file AND read it back to verify. Gate requires `fs_read` to be executed AFTER `fs_write`.
  - `isCalculationTask`: User asked a math/reasoning prompt. Gate passes without requiring tools or skills.

### E. Hiding Internal Model Reasoning from UI
- **Root Cause**:
  Models emitted raw text headers (`Thinking Process:`, `**Analyze the Request**`) and text streams (`[Jarvis Agent: Executing the next required action...]`).
- **Fix**:
  - Updated `MessageBubble.tsx` `stripToolTags` to strip raw reasoning headers (`Thinking Process`, `Analyze the Request`, `Self-Correction`) and text markers (`[Jarvis Agent...]`, `[Autonomous Agent Directive]`).
  - Removed `[Jarvis Agent...]` text stream emission from `AgentOrchestrator.ts`.

---

## 3. Empirical Test & Verification Results

### A. Live Vitest Test Suites
All 8 regression tests passed (Code 0):

```
 RUN  v3.2.7 D:/SOVARA/apps/desktop

 ✓ tests/live.agent.behavior.regression.test.ts (5 tests) 40ms
   ✓ Requirement 1 & 8: Simple calculation task does NOT trigger xlsx skill or tools
   ✓ Requirement 2 & 7: File name recovery with duplicate extension (.txt.txt hint)
   ✓ Requirement 3 & 4: Prevent placeholder artifact success and enforce intent-aware completion logic
   ✓ Requirement 5: Raw internal reasoning and Jarvis directives are stripped from UI bubbles
   ✓ Requirement 9 & 10: Normal file workflow and multi-step write + verify workflow
 ✓ tests/live.runtime.ui.sink.test.ts (3 tests) 7ms
   ✓ Subscribers receive agent events and update canonical status & diagnostic log
   ✓ Error status & recovery handling in canonical store
   ✓ Completion gate message accurately reflects executed tools when tools succeed

 Test Files  2 passed (2)
      Tests  8 passed (8)
   Duration  1.93s
```

### B. TypeScript Compilation
- **Command**: `pnpm --filter @sovara/desktop typecheck`
- **Result**: **Passed (Code 0)** with zero TypeScript errors.

### C. Electron Production Build
- **Command**: `pnpm --filter @sovara/desktop build`
- **Result**: **Passed (Code 0)** clean production bundle.

---

## 4. Test Scenario Verification Table

| Test Scenario | User Request | Expected Behavior | Actual Behavior | Result |
| :--- | :--- | :--- | :--- | :--- |
| **Arithmetic Calculation** | "A production line has 3 machines... calculate total production" | 1740 units. Zero tools, zero xlsx skills. | Direct reasoning output: 1740 units. No tools or skills invoked. | **PASSED** |
| **Filename Recovery** | "Read production_notes.txt" (file is `production_notes.txt.txt`) | `fs_read` fails, recovers via hint, reads `production_notes.txt.txt`. No placeholder summary. | `fs_read` failed, read hint, called `fs_read("production_notes.txt.txt")`, returned real data. | **PASSED** |
| **Normal File Read** | "Read production_notes.txt and tell me highest production rate" | Single `fs_read`, accurate answer, task completed cleanly. | Single `fs_read`, parsed machine stats, completed task. | **PASSED** |
| **Multi-Step Write & Verify** | "Read production_notes.txt... Create production_summary.md... then read it back and verify it" | `fs_read` → calculation → `fs_write` → `fs_read` verification → completed. | `fs_read` → calculation → `fs_write` → `fs_read` verification → completed. | **PASSED** |
