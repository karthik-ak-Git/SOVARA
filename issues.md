# SOVARA System Audit & Issue Report

## Executive Summary
Following an in-depth audit of the SOVARA codebase (`d:\SOVARA`) and analysis of the user's uploaded test artifacts (including the screenshot showing raw JSON tool payload strings inside PDF files), we identified and resolved six major architectural and runtime defects.

---

## Identified Issues & Resolutions

### 1. Raw JSON Tool Payload Leakage into PDF Artifacts (User Screenshot Error)
- **Symptom**: Generated PDF files printed raw JSON tool call envelopes like `"content": "from reportlab.lib...", "query": "pdf", "maxresults": 5`.
- **Root Cause**: `stripThinkingTags` in `artifacts.ts` only removed HTML tag strings (`<think>`, `<thinking>`) without unwrapping JSON response objects or unescaping escaped strings (`\n`, `\t`, `\"`). When `writePdfFile` ran as a fallback, it printed the JSON string verbatim into the PDF.
- **Resolution**: Enhanced `stripThinkingTags` in `artifacts.ts` to unwrap JSON envelopes (`parsed.content`), strip `<think>...</think>`, `json:reasoning`, and `SYSTEM GATE:` headers, and unescape string characters before creating PDF/DOCX/PPTX/XLSX artifacts.

2. **Skill Discovery & UI Listing Disconnect**
   - **Root Cause**: `skillsScanner.ts` omitted `.gemini/antigravity/skills` and `.sovara/skills` from `SKILL_SOURCES`, and `listDetailedSkillsForSources` excluded Bionic, workspace, and bundled desktop skills.
   - **Resolution**: Added missing skill source paths and updated `listDetailedSkillsForSources` to aggregate Bionic, workspace, and desktop skills for UI autocomplete (`Composer.tsx`) and skills management (`SkillsPage.tsx`).

3. **2D Memory / Knowledge Graph Omission**
   - **Root Cause**: `sovaraSystem.ts` system prompt lacked a `tool:memory` section, and `AgentOrchestrator.ts` did not automatically trigger memory persistence when memory/wiki instructions were present.
   - **Resolution**: Added `TOOL_MEMORY` (order `1650`) to `SOVARA_SECTIONS`, included `'Memory'` in `TOOL_ORDER`, and added an automated 2D Memory write trigger in `AgentOrchestrator.ts` that writes structured markdown pages (`wiki/entities/*.md`, `wiki/concepts/*.md`) with `[[wikilinks]]` for the Knowledge Graph.

4. **Unwanted Browser Popups & PDF Artifact Canvas Viewing**
   - **Root Cause**: `App.tsx` `handleOpenArtifactFileInPanel` executed `openArtifact` (`shell.openPath`), which launched Windows' default browser on every artifact click.
   - **Resolution**: Updated `App.tsx` to open internal Artifact Canvas panels without external browser popups, and updated `previewBundler.ts` so document artifacts load clean preview cards in the Artifact Canvas.

5. **Context Window Token Overflow (`exceed_context_size_error`)**
   - **Root Cause**: In multi-step tool loops, `AgentOrchestrator.ts` underestimated token counts, allowing messages to reach 12,581 tokens against `n_ctx=12288`.
   - **Resolution**: Hardened the tool loop context compactor to prune `skillsContext` and older messages when context usage exceeds 70% of `n_ctx`.

6. **External Model Un-Integration & Settings Delete Exception**
   - **Root Cause**: `deleteLibraryEntry` threw `path escapes the model library` when deleting imported external models (e.g. from LM Studio or `.node-llama-cpp`).
   - **Resolution**: Updated `deleteLibraryEntry` in `modelDownloads.ts` to un-register external models from SOVARA's registry without deleting external files from disk or throwing path errors.

---

## 6-Task End-to-End Verification Results
All 6 core execution tasks were tested and validated in `tests/live.execution.tasks.test.ts`:
1. **Task 1: PDF Generation** — Generated clean PDF artifact without raw JSON code strings (100% PASS).
2. **Task 2: Image / Architecture Visual** — Generated SVG architectural diagram using code/skills (100% PASS).
3. **Task 3: Excel Data** — Generated multi-sheet XLSX workbook with metric tables (100% PASS).
4. **Task 4: Word Document** — Generated structured DOCX document with sections (100% PASS).
5. **Task 5: PDF Presentation** — Generated clean PDF presentation deliverable (100% PASS).
6. **Task 6: 2D Memory & React Artifact** — Dispatched `memory` tool creating `wiki/entities/` and `wiki/concepts/` markdown files with `[[wikilinks]]` (100% PASS).
