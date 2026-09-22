# SOVARA Agent Execution Audit & Remediation

## Problem Summary
Your SOVARA system **claims** agentic behavior but **doesn't enforce** it:
- Skills are scanned & ranked but rarely *actually read* and their templates *obeyed*
- Work is planned (todo_write) but often abandoned after first tool call
- Model selection is automated but task classification is shallow
- Multimodal (OCR, vision on scanned docs) is mentioned but not wired
- The system *pretends* to read skills and claims "Generation is fast" when it should be "Planning is thorough"

## Root Causes

### 1. **Skill Reading is Gated Behind User Tool Calls**
**Current (broken):** 
```
skillsContext injected → (maybe) user asks search_skills → (maybe) user asks read_skill
→ SOVARA ignores and generates anyway
```
**Issue:** The prompt says "Skill-First" but there's no *enforcement mechanism*. If the LLM decides to skip skill reading, nothing stops it.

**Fix:** 
- Make `search_skills` + `read_skill` **mandatory checkpoints** in the tool loop
- Don't allow artifact generation until skill has been read and confirmed in tool history
- Add a gate in `artifactPipeline` section that blocks fs_write until `tools.find(t => t.name === 'read_skill' && t.result.includes('SKILL.md content'))` exists

---

### 2. **Task Classification is Too Shallow**
**Current:** `TaskClassifier.ts:46` checks CODING_PATTERNS / BUILD_INTENT_RE, decides reasoning tier.  
**Issue:** Doesn't classify *skill need* (pptx/xlsx/ocr/diagram/code/rag) until after model is already pinned.

**Fix:**
```typescript
// New: classifyTaskSkills(content) → {neededSkills: ['pptx','ocr','rag'], priority:'high'}
// Then: loadEnabledSkillsContent BEFORE routeModel(), not after
// Inject {neededSkills} into system prompt so LLM knows what it must read
```

---

### 3. **Model Selection Ignores Multimodal & Task-Specific Needs**
**Current:** `ModelRouter.ts:81` picks model by context length & load pressure only.  
**Issue:** A scanned PDF inspection task needs vision; a coding task needs reasoning; but router treats them the same.

**Fix:**
- Add `task.classification.capabilities` → ['vision','reasoning','coding']
- Filter `listInstances()` by model.metadata.supports_vision / supports_reasoning
- Prefer models that match task needs (e.g., Llama 2 Vision for OCR, DeepSeek-R1 for reasoning)

---

### 4. **Tool Loop Doesn't Enforce Agent Completion**
**Current:** `while(loopSteps < 8)` — if LLM gives up early, loop exits and work is declared "done".  
**Issue:** No checkpoints for "did you actually finish the task?" or "have you read the skill?" or "did you verify the output?"

**Fix:**
```typescript
// Add mandatory gates:
if (needsSkillRead && !hasReadSkill) {
  // Force search_skills + read_skill as next mandatory tool call
  appendSystemNote("You must read the skill before generating artifacts. Call search_skills now.");
  continue;
}
if (taskType === 'artifact' && !hasGeneratedArtifact) {
  appendSystemNote("You declared plan but did not generate. Continue with fs_write / python script.");
  continue;
}
```

---

### 5. **Multimodal Vision/OCR Not Wired into Message Chain**
**Current:** File upload handling in `ChatService.ts:329` accepts attachments but doesn't trigger vision model load.  
**Issue:** A scanned PDF arrives, gets stored, but orchestrator doesn't know "this needs vision."

**Fix:**
- In `classifyTask()`, detect `attachment.mimeType` = `image/*` or `application/pdf`
- Set `classification.requiresVision = true`
- In `ModelRouter`, prioritize vision-capable models
- In message construction, attach image as `{type:'image', source: {type:'base64', media_type:...}, data:base64}`

---

### 6. **Skill Context Truncation Loses Instructions**
**Current:** `loadEnabledSkillsContent()` returns top 4 skills, each sliced to 2200 chars.  
**Issue:** SKILL.md often has critical workflow steps cut off. LLM sees partial instructions and invents own path.

**Fix:**
- Don't slice; load full SKILL.md for matched skills
- Summarize non-matched skills at tail
- Add `// === SKILL.md START: {skillName} ===` fences so LLM treats as authoritative template

---

### 7. **Approval Gate is Separate from Agent Loop**
**Current:** Tool needs approval → emit `agent:needs-approval` → user clicks card → `orchestrator.resolveToolApproval()` → rememberApproval → continue loop.  
**Issue:** User click breaks the "autonomous" flow. For sensitive work (approval notes, finance calcs), this is actually correct—but the *system prompt* claims "Autonomous — proceed reversible, ask only destructive" which is contradictory.

**Fix:**
- Clarify: **Sensitive tasks** (artifact writes, shell execs) require approval in 'review' mode (default).
- **Quick tasks** (read, grep, web search) proceed silently.
- Update prompt: "Ask for approval on fs_write/shell_exec in 'review' mode (default for industrial use). 'auto' mode skips approval but logs all tool calls."

---

## Execution Flow Gaps

### Current (Broken) Flow:
```
user input
  ↓
classifyTask (shallow, ignores multimodal)
  ↓
routeModel (ignores task needs, picks by load)
  ↓
inject system prompt + skillsContext (truncated, optional)
  ↓
while (loopSteps < 8):
    LLM streams → (maybe reads skill, maybe not, no enforcement)
       ↓
       (maybe calls search_skills, maybe ignores)
       ↓
       (maybe calls read_skill, maybe ignores)
       ↓
       (generates artifact anyway, skill instructions ignored)
       ↓
    tool fence collected
    gateDispatch (checks permissions, not task compliance)
    execTool (fs_write/shell/python happens)
    result appended
    
exit (loop limit or LLM says "done")
  ↓
detectOutputFormat (looks for .pptx/.xlsx filename)
  ↓
artifact/created event
```

### Fixed Flow:
```
user input + attachments
  ↓
classifyTask ENHANCED:
  - detectMultimodal(attachments) → needsVision
  - detectSkillNeeds(content) → [pptx, ocr, rag, code]
  - estimateReasoningDepth(content) → tier
  ↓
routeModel ENHANCED:
  - filter models by capabilities (vision, reasoning, coding)
  - prefer model.supports[need] for each detected skill
  ↓
loadEnabledSkillsContent ENHANCED:
  - search_skills filtered by neededSkills
  - load FULL SKILL.md (no truncation)
  - mark in system prompt: "YOU MUST READ: {skillNames}"
  ↓
attachImages to messages if multimodal:
  - base64 encode PDF pages / images
  - include in vision model request
  ↓
while (loopSteps < 32, or until task.complete):
    checkSkillReadGate():
      if needsSkillRead && !hasReadSkill:
        force search_skills → read_skill (no LLM choice)
    
    LLM streams with FULL skill templates visible
    
    detects tool calls (search_skills, read_skill, fs_write, shell_exec, etc)
    
    checkOutputGate():
      if taskType.needsArtifact && !artifact.generated:
        force fs_write / python generation
    
    tool fence collected & validated
    
    gateDispatch checks:
      - task compliance (skill read? artifact declared?)
      - permissions (approval needed?)
      - safety (sandboxing)
    
    execTool with full logging (no external calls)
    
    result appended
    
    checkTaskComplete():
      if artifact generated && verified:
        exit loop with success
      elif loopSteps > 24:
        timeout, escalate to user
        
artifact verified & saved
```

---

## Implementation Checklist

### Phase 1: Task Classification & Model Selection (Week 1)
- [ ] Extend `TaskClassifier.ts`: add `classifyTaskSkills()` and `detectMultimodal()`
- [ ] Extend `ModelRouter.ts`: filter by capabilities, prefer matching models
- [ ] Test: "read a scanned PDF inspection report" → vision model selected

### Phase 2: Skill Reading Gates (Week 1-2)
- [ ] Add `checkSkillReadGate()` in orchestrator tool loop
- [ ] Block artifact generation until skill read confirmed
- [ ] Test: "create a pptx" → forces search_skills + read_skill before fs_write

### Phase 3: Multimodal Support (Week 2)
- [ ] Wire attachment base64 encoding into message construction
- [ ] Test: upload PDF → vision model receives image data
- [ ] Add OCR fallback if vision model not available (use local Tesseract or similar)

### Phase 4: Agent Completion Gates (Week 2-3)
- [ ] Add `checkOutputGate()` — force artifact generation if needed
- [ ] Add `checkTaskComplete()` — verify output quality before loop exit
- [ ] Test: "write approval note" → confirms Word file created & content makes sense

### Phase 5: Logging & Audit (Week 3)
- [ ] Add full execution trace: which model, which skills, which tools, time per step
- [ ] Add network monitor hook (intercept fetch/http calls, log or block)
- [ ] Test: run end-to-end task, verify zero external network calls

### Phase 6: Documentation & User Onboarding (Week 3-4)
- [ ] Update system prompt to reflect actual behavior (not "pretend fast")
- [ ] Add execution logs to UI (what the LLM is doing, which skills it read, which model)
- [ ] Create runbook: "How to add a new model" and "How to verify air-gapped"

---

## Key Files to Update

| File | Change | Reason |
|------|--------|--------|
| `TaskClassifier.ts` | Add `classifyTaskSkills()`, `detectMultimodal()` | Detect what the task needs |
| `ModelRouter.ts` | Filter by `model.capabilities`, prefer matches | Route to right model |
| `AgentOrchestrator.ts` | Add `checkSkillReadGate()`, `checkOutputGate()`, `checkTaskComplete()` | Enforce agent behavior |
| `ChatService.ts` | Attach base64 images to message before LLM call | Multimodal support |
| `sovaraSystem.ts` | Update ARTIFACT_PIPELINE section to describe gate, update tone to "actual behavior not claims" | Honest prompt |
| `LlamaCppServerAdapter.ts` | Add full execution logging (model, step, time, tokens) | Audit trail |
| `ExecutionTrace.ts` (new) | Structured logging of all tool calls, approvals, network checks | Transparency |

---

## Expected Outcomes After Fix

### Before:
```
User: "Read this scanned inspection report and draft an approval note"
System: (no vision model selected, skill not read, generic text generation)
Output: "The inspection report shows... [generic summary]" (still in chat)
Reality: LLM guessed, no actual PDF reading, no Word file, user manually copies to Word
```

### After:
```
User: "Read this scanned inspection report and draft an approval note"
System:
  - classifyTask detects multimodal (PDF) + needsArtifact (docx)
  - routes to vision model (e.g., LLaVA or Llama 2 Vision)
  - loads docx skill, pptx skill (truncated but full template)
  - attaches PDF pages as base64 images
  - LLM calls search_skills → read_skill (enforced)
  - reads SKILL.md for docx generation
  - calls fs_write with Python docx template
  - executes python script
  - Word file created in artifacts/
  - logs show: zero external calls, vision model used, skill template followed
Output: Real Word (.docx) file with structured findings + approval checkbox + sign-off section
Reality: User opens file, reviews, signs, sends to stakeholder. Done in 2 minutes.
```

---

## Testing Strategy

### Tier 1: Unit Tests
- `classifyTask()` with multimodal attachment → `{needsVision: true, skillsNeeded: ['ocr', 'docx']}`
- `checkSkillReadGate()` with skill not read → return "must read skill" error
- `ModelRouter.filter()` by capability → vision model selected for vision task

### Tier 2: Integration Tests
- E2E: upload PDF → skill read → docx generated → file exists
- E2E: "code this function" → reasoning model selected, skill read, code executed, test passes
- E2E: "create dashboard" → UI skill read, React code generated, artifact preview works

### Tier 3: System Tests
- **Air-Gap Proof:** Run task with network monitor (e.g., Wireshark), verify zero external calls
- **Multimodal Proof:** Scanned drawing → OCR extracts content → engineering calc generated
- **Model Swap Proof:** Remove one model, add another, system auto-routes without redesign

---

## Industrial Deployment Readiness Checklist

- [ ] **Confidentiality:** All data stays on-premises (network audit log)
- [ ] **Modularity:** Models can be added/swapped without code changes
- [ ] **Agentic:** Multi-step work completed autonomously (within approval gates)
- [ ] **Multimodal:** Scanned docs + handwritten notes processable
- [ ] **Deliverables:** Real Word/Excel/PDF/code files, not chat summaries
- [ ] **Auditability:** Full execution log (model, skill, tool, time, network)
- [ ] **Governance:** Approval gates for sensitive operations (default 'review' mode)

---

## Next Steps

1. **This week:** Review this audit with your team. Prioritize Phase 1 (task classification) + Phase 2 (skill gates).
2. **Meeting:** Clarify approval workflow (auto vs. review mode) and sensitive-operation policy.
3. **Development:** Start Phase 1. Have a working "read PDF + detect vision need + select vision model" by end of week.
4. **Demo:** By end of sprint, show end-to-end task (scanned inspection → approval note Word file) with execution log visible.

---

## Questions for Your Team

1. **Approval workflow:** Is *every* artifact generation approved, or only destructive operations (shell_exec)?
2. **Sensitive tasks:** Which operations need audit logs? (All? Or only approval notes, finance calcs, design reviews?)
3. **Model priorities:** If multiple models available, should the system prefer speed (smaller model) or accuracy (larger model)?
4. **Multimodal fallback:** If vision model not available, should OCR (local Tesseract) be used, or error out?
5. **Air-gap verification:** Do you have a network monitor setup (Wireshark, etc.) for the demo, or should we add one to the app?

