# SOVARA Remediation & Implementation Plan

## Objective
Restore full skill discovery, reading, adaptation, and utilization in SOVARA, re-enable 2D Memory (`wiki/` Knowledge Graph) auto-writing, eliminate orchestrator gate deadlocks, and ensure high-quality PPTX, XLSX, DOCX, and PDF artifact generation.

---

## Step-by-Step Action Plan

### Phase 1: Fix Skill Scanner, Discovery & UI Listing
1. **Expand Skill Sources** (`apps/desktop/src/main/services/skillsScanner.ts`):
   - Add missing skill paths to `SKILL_SOURCES`: `.gemini/antigravity/skills`, `.sovara/skills`, and user plugin skill paths.
2. **Comprehensive Detailed Skills Aggregation**:
   - Update `listDetailedSkillsForSources` to aggregate Bionic skills (`~/.sovara/skills`), workspace-local skills (`.skills`, `skills`), and bundled skills alongside global sources.
   - Ensures `Composer.tsx` @-mention autocomplete and `SkillsPage.tsx` display every installed skill.

### Phase 2: 2D Memory & System Prompt Integration
1. **System Prompt Update** (`apps/desktop/src/main/backend/prompts/sovaraSystem.ts`):
   - Add `TOOL_MEMORY` section (order 1650) to `SOVARA_SECTIONS`.
   - Update `TOOL_ORDER` to include `'Memory'`.
   - Provide explicit instructions on `tool:memory` schema (`action: "store" | "recall" | "list"`, `title`, `type`, `body`, `links`, `tags`).
   - Instruct SOVARA to automatically persist important facts, user preferences, and project concepts into 2D Memory (`wiki/` folder with `[[wikilinks]]`).

### Phase 3: Skill Routing & Orchestrator Gate Hardening
1. **Harden Gate & Execution** (`apps/desktop/src/main/backend/AgentOrchestrator.ts`):
   - Ensure `checkSkillReadGate` matches format buckets (`pptx`, `docx`, `xlsx`, `pdf`) to actual skill names (`pptx-official`, `docx-official`, etc.).
   - Prevent prompt-injection loop deadlocks by gracefully falling back when a requested skill is read or unavailable.
   - Fix `needsInspectionAction` so completed file mutations and command outputs are recognized as successful completions without false-positive inspection blocks.

### Phase 4: Document Generation & Encoding Cleanup
1. **Clean Character Corruptions** (`apps/desktop/src/main/backend/tools/fenceTools.ts`):
   - Replace garbled UTF-8 artifacts (`â€”`, `â†’`, `â€¢`) with clean ASCII / standard UTF-8 characters.
2. **Enhance Document Builders** (`apps/desktop/src/main/backend/artifacts.ts`):
   - Ensure `markdownToSlides`, `markdownToParagraphs`, `markdownToSheets`, and PDF generators handle headings, lists, and tables cleanly without producing empty or blank elements.

### Phase 5: Verification & Quality Assurance
1. **Run Contract & Integration Test Suites**:
   - `npx vitest run tests/skillgate.contract.test.ts`
   - `npx vitest run tests/skills.search.routing.test.ts`
   - `npx vitest run tests/tools.contract.test.ts`
   - `npx vitest run tests/prompt.contract.test.ts`
   - `npx vitest run tests/attachments.artifacts.test.ts`
2. **Verify 2D Memory & Skill Execution**:
   - Verify `memory` tool stores structured `.md` files in `wiki/entities/` and `wiki/concepts/`.
   - Verify skill search and read operations return expected results.
