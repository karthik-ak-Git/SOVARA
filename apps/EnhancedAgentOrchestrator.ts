/**
 * ENHANCED AgentOrchestrator.ts — Skill Gates + Task Compliance + Multimodal
 * 
 * Key Changes:
 * 1. classifyTaskEnhanced() detects multimodal, skill needs, completion gates
 * 2. enforceSkillReadGate() blocks artifact generation until skill is read
 * 3. checkTaskCompletion() verifies output before loop exit
 * 4. attachMultimodalContent() prepares images for vision models
 * 5. ExecutionTrace logs every step for audit
 */

import { EventEmitter } from 'events';
import path from 'path';

// ============================================================================
// Type Definitions
// ============================================================================

export interface TaskClassification {
  type: 'coding' | 'document' | 'knowledge' | 'creative' | 'analysis';
  needsReasoning: boolean;
  reasoningTier: 'shallow' | 'standard' | 'deep';
  contextLengthNeeded: number;
  // NEW FIELDS:
  needsMultimodal: boolean;
  needsVision: boolean;
  skillsNeeded: string[]; // ['pptx', 'docx', 'ocr', 'rag', 'code']
  requiresArtifact: boolean;
  artifactType?: 'pptx' | 'docx' | 'xlsx' | 'pdf' | 'code' | 'html';
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  timestamp: number;
  stepNumber: number;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  output: string;
  timestamp: number;
}

export interface ExecutionTrace {
  sessionId: string;
  taskClassification: TaskClassification;
  selectedModel: string;
  loadedSkills: Array<{ name: string; path: string; readAt: number }>;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  gateChecks: Array<{ gate: string; passed: boolean; message: string; step: number }>;
  startTime: number;
  endTime?: number;
  success: boolean;
  finalArtifact?: { path: string; mimeType: string; size: number };
  networkCalls: Array<{ url: string; blocked: boolean; timestamp: number }>;
}

export interface AgentExecutionState {
  hasReadSkill: boolean;
  skillsRead: Map<string, string>; // skillName -> fullContent
  hasGeneratedArtifact: boolean;
  artifactPath?: string;
  stepCount: number;
  gatesPassed: Set<string>;
  gatesFailed: Set<string>;
  taskClassification: TaskClassification;
}

// ============================================================================
// PHASE 1: Enhanced Task Classification
// ============================================================================

export class EnhancedTaskClassifier {
  /**
   * Detect multimodal needs from attachments
   */
  static detectMultimodal(attachments: Array<{ mimeType: string; size: number; name: string }>): {
    needsVision: boolean;
    types: string[];
  } {
    const types = new Set<string>();
    let needsVision = false;

    for (const att of attachments) {
      if (att.mimeType.startsWith('image/')) {
        types.add('image');
        needsVision = true;
      }
      if (att.mimeType === 'application/pdf') {
        types.add('pdf');
        // PDFs may contain images, so assume vision might help
        needsVision = true;
      }
      if (att.mimeType.startsWith('application/vnd.openxmlformats-officedocument')) {
        types.add('document');
      }
    }

    return { needsVision, types: Array.from(types) };
  }

  /**
   * Detect what skills the task will need
   */
  static detectSkillNeeds(content: string, attachments?: Array<{ mimeType: string }>): string[] {
    const needs = new Set<string>();

    // Regex patterns for skill detection
    const patterns = {
      pptx: /\b(pptx|powerpoint|presentation|slide|deck)\b/gi,
      docx: /\b(docx|word|document|approval.*note|memo|letter)\b/gi,
      xlsx: /\b(xlsx|excel|spreadsheet|calculation|financial|budget)\b/gi,
      pdf: /\b(pdf|convert.*pdf|export.*pdf)\b/gi,
      ocr: /\b(scan|ocr|handwritten|extract.*text|read.*image)\b/gi,
      diagram: /\b(mermaid|flowchart|diagram|architecture|uml)\b/gi,
      code: /\b(function|class|algorithm|script|execute|run.*code)\b/gi,
      rag: /\b(search|knowledge.*base|sop|manual|reference|document.*search)\b/gi,
    };

    for (const [skill, pattern] of Object.entries(patterns)) {
      if (pattern.test(content)) {
        needs.add(skill);
      }
    }

    // Detect from attachments
    if (attachments) {
      const { needsVision } = this.detectMultimodal(attachments);
      if (needsVision) {
        needs.add('vision');
        needs.add('ocr');
      }
    }

    return Array.from(needs);
  }

  /**
   * Enhanced classification with multimodal + skill detection
   */
  static classifyTaskEnhanced(
    content: string,
    attachments?: Array<{ mimeType: string; size: number; name: string }>
  ): TaskClassification {
    // Original shallow classification
    const needsReasoning = /\b(reason|think|plan|analyze|complex)\b/i.test(content);
    const isCoding = /\b(function|class|algorithm|code|script|debug)\b/i.test(content);
    const isDocument = /\b(write|draft|note|summary|report|memo)\b/i.test(content);

    // NEW: Multimodal detection
    const { needsVision, types } = attachments ? this.detectMultimodal(attachments) : { needsVision: false, types: [] };

    // NEW: Skill needs detection
    const skillsNeeded = this.detectSkillNeeds(content, attachments);

    // Determine task type
    let type: TaskClassification['type'] = 'analysis';
    if (isCoding) type = 'coding';
    else if (isDocument) type = 'document';
    else if (skillsNeeded.includes('rag')) type = 'knowledge';

    // Determine if artifact is required
    const requiresArtifact = skillsNeeded.some((s) => ['pptx', 'docx', 'xlsx', 'pdf', 'code', 'html'].includes(s));

    // Map skills to artifact type
    let artifactType: TaskClassification['artifactType'];
    if (skillsNeeded.includes('pptx')) artifactType = 'pptx';
    else if (skillsNeeded.includes('docx')) artifactType = 'docx';
    else if (skillsNeeded.includes('xlsx')) artifactType = 'xlsx';
    else if (skillsNeeded.includes('code')) artifactType = 'code';
    else if (skillsNeeded.includes('pdf')) artifactType = 'pdf';

    return {
      type,
      needsReasoning,
      reasoningTier: needsReasoning ? 'deep' : 'standard',
      contextLengthNeeded: needsReasoning ? 16384 : 8192,
      needsMultimodal: types.length > 0,
      needsVision,
      skillsNeeded,
      requiresArtifact,
      artifactType,
    };
  }
}

// ============================================================================
// PHASE 2: Skill Reading Gate Enforcement
// ============================================================================

export class SkillReadingGate {
  /**
   * Check if required skills have been read in the execution trace
   */
  static checkSkillReadGate(
    state: AgentExecutionState,
    classification: TaskClassification,
    toolHistory: ToolCall[]
  ): { passed: boolean; required: string[]; missing: string[]; message: string } {
    if (!classification.skillsNeeded || classification.skillsNeeded.length === 0) {
      return { passed: true, required: [], missing: [], message: 'No skills needed for this task' };
    }

    // Did LLM call search_skills?
    const calledSearchSkills = toolHistory.some((t) => t.name === 'search_skills');

    // Did LLM call read_skill for each required skill?
    const skillsRead = new Set(
      toolHistory.filter((t) => t.name === 'read_skill').map((t) => (t.args.skill_name as string) || '')
    );

    const missing = classification.skillsNeeded.filter((s) => !skillsRead.has(s) && !state.skillsRead.has(s));

    if (missing.length > 0) {
      return {
        passed: false,
        required: classification.skillsNeeded,
        missing,
        message: `GATE FAILED: Must read skills before generating artifacts. Missing: ${missing.join(', ')}. Call search_skills then read_skill {skill_name: '${missing[0]}'}`,
      };
    }

    return {
      passed: true,
      required: classification.skillsNeeded,
      missing: [],
      message: 'Skill reading gate passed. All required skills have been read.',
    };
  }

  /**
   * Generate a system prompt injection to force skill reading
   */
  static generateSkillGateInjection(missing: string[]): string {
    if (missing.length === 0) return '';

    return `
### MANDATORY SKILL READING (Agent Compliance Gate)

You are required to read the following skills before generating any artifacts:
${missing.map((s) => `- ${s}`).join('\n')}

**Steps:**
1. Call \`search_skills\` with query matching the skill (e.g., query="pptx presentation" for pptx skill)
2. From the results, call \`read_skill\` with the exact skill name
3. Study the SKILL.md template and instructions
4. THEN and only then, proceed with artifact generation using the skill's exact template

Do not skip this step. Do not invent your own structure.
    `;
  }
}

// ============================================================================
// PHASE 3: Task Completion Gate
// ============================================================================

export class TaskCompletionGate {
  /**
   * Verify that the required output was actually generated
   */
  static checkTaskCompletion(
    state: AgentExecutionState,
    classification: TaskClassification,
    toolResults: ToolResult[]
  ): { passed: boolean; message: string; nextAction?: string } {
    // If no artifact is required, task is complete when LLM says so
    if (!classification.requiresArtifact) {
      return { passed: true, message: 'No artifact required. Task complete when LLM finishes.' };
    }

    // Check if fs_write was called with artifact file
    const artifactWrites = toolResults.filter((r) => r.toolName === 'fs_write' && r.success);

    if (artifactWrites.length === 0 && !state.hasGeneratedArtifact) {
      return {
        passed: false,
        message: `GATE FAILED: Artifact type '${classification.artifactType}' was required but not generated.`,
        nextAction: `Proceed with fs_write to generate ${classification.artifactType} file using the skill template.`,
      };
    }

    if (state.hasGeneratedArtifact) {
      return {
        passed: true,
        message: `Task completion gate passed. Artifact generated: ${state.artifactPath}`,
      };
    }

    return { passed: true, message: 'Artifact generation in progress or complete.' };
  }

  /**
   * Generate system prompt injection if task incomplete
   */
  static generateCompletionInjection(classification: TaskClassification, artifactPath?: string): string {
    if (classification.requiresArtifact && !artifactPath) {
      return `
### ARTIFACT GENERATION REQUIRED (Agent Compliance Gate)

You declared that a ${classification.artifactType} file is needed, but you have not yet generated it.

**Next step:** Use \`fs_write\` (or shell_exec with Python) to create the file:
- Call \`fs_write\` with path: "./artifacts/output.${classification.artifactType}"
- Or: write a Python script (using python-pptx, python-docx, openpyxl, etc.) and call \`shell_exec\`

Do not ask the user to do this. Generate it now.
      `;
    }
    return '';
  }
}

// ============================================================================
// PHASE 4: Multimodal Content Attachment
// ============================================================================

export class MultimodalContentAttacher {
  /**
   * Convert attachment file to base64 and structure for vision model
   */
  static async attachMultimodalContent(
    attachments: Array<{ path: string; mimeType: string; name: string }>,
    readFile: (path: string) => Promise<Buffer>
  ): Promise<Array<{ type: string; source: Record<string, unknown> }>> {
    const result = [];

    for (const att of attachments) {
      try {
        const buffer = await readFile(att.path);
        const base64 = buffer.toString('base64');

        if (att.mimeType.startsWith('image/')) {
          result.push({
            type: 'image',
            source: { type: 'base64', media_type: att.mimeType, data: base64 },
          });
        } else if (att.mimeType === 'application/pdf') {
          // For PDFs, include as document type
          result.push({
            type: 'document',
            source: { type: 'base64', media_type: att.mimeType, data: base64 },
          });
        }
      } catch (err) {
        console.error(`Failed to attach ${att.name}:`, err);
      }
    }

    return result;
  }
}

// ============================================================================
// PHASE 5: Execution Trace & Audit Logging
// ============================================================================

export class ExecutionTracer {
  private trace: ExecutionTrace;

  constructor(sessionId: string, classification: TaskClassification, selectedModel: string) {
    this.trace = {
      sessionId,
      taskClassification: classification,
      selectedModel,
      loadedSkills: [],
      toolCalls: [],
      toolResults: [],
      gateChecks: [],
      startTime: Date.now(),
      success: false,
      networkCalls: [],
    };
  }

  recordToolCall(stepNumber: number, name: string, args: Record<string, unknown>): void {
    this.trace.toolCalls.push({
      name,
      args,
      timestamp: Date.now(),
      stepNumber,
    });
  }

  recordToolResult(toolName: string, success: boolean, output: string): void {
    this.trace.toolResults.push({
      toolName,
      success,
      output,
      timestamp: Date.now(),
    });
  }

  recordGateCheck(step: number, gate: string, passed: boolean, message: string): void {
    this.trace.gateChecks.push({
      gate,
      passed,
      message,
      step,
    });
  }

  recordSkillRead(skillName: string, skillPath: string): void {
    this.trace.loadedSkills.push({
      name: skillName,
      path: skillPath,
      readAt: Date.now(),
    });
  }

  recordNetworkCall(url: string, blocked: boolean): void {
    this.trace.networkCalls.push({
      url,
      blocked,
      timestamp: Date.now(),
    });
  }

  recordArtifact(path: string, mimeType: string, size: number): void {
    this.trace.finalArtifact = { path, mimeType, size };
  }

  finalize(success: boolean): ExecutionTrace {
    this.trace.endTime = Date.now();
    this.trace.success = success;
    return this.trace;
  }

  getFormattedLog(): string {
    const trace = this.trace;
    const duration = (trace.endTime ?? Date.now()) - trace.startTime;

    return `
=== SOVARA EXECUTION TRACE ===
Session: ${trace.sessionId}
Model: ${trace.selectedModel}
Duration: ${duration}ms
Success: ${trace.success}

TASK CLASSIFICATION:
  Type: ${trace.taskClassification.type}
  Needs Reasoning: ${trace.taskClassification.needsReasoning}
  Needs Multimodal: ${trace.taskClassification.needsMultimodal}
  Skills Needed: ${trace.taskClassification.skillsNeeded.join(', ') || 'none'}
  Requires Artifact: ${trace.taskClassification.requiresArtifact}

SKILLS LOADED:
${trace.loadedSkills.map((s) => `  - ${s.name} (${s.path}) @ ${new Date(s.readAt).toISOString()}`).join('\n') || '  (none)'}

TOOL CALLS (${trace.toolCalls.length}):
${trace.toolCalls.map((t) => `  [Step ${t.stepNumber}] ${t.name}(${JSON.stringify(t.args).substring(0, 60)}...) @ ${new Date(t.timestamp).toISOString()}`).join('\n') || '  (none)'}

GATE CHECKS:
${trace.gateChecks.map((g) => `  [Step ${g.step}] ${g.gate}: ${g.passed ? '✓ PASS' : '✗ FAIL'} - ${g.message}`).join('\n') || '  (none)'}

NETWORK CALLS:
${trace.networkCalls.map((n) => `  ${n.blocked ? '🔒 BLOCKED' : '⚠️  ALLOWED'} ${n.url} @ ${new Date(n.timestamp).toISOString()}`).join('\n') || '  (no external calls)'}

FINAL ARTIFACT:
${trace.finalArtifact ? `  Path: ${trace.finalArtifact.path}\n  Type: ${trace.finalArtifact.mimeType}\n  Size: ${trace.finalArtifact.size} bytes` : '  (none)'}

=== END TRACE ===
    `;
  }
}

// ============================================================================
// PHASE 6: Enhanced Agent Orchestrator Main Loop
// ============================================================================

export class EnhancedAgentOrchestrator extends EventEmitter {
  async execute(
    content: string,
    attachments: Array<{ path: string; mimeType: string; name: string }> = [],
    tools: Record<string, unknown> = {}
  ): Promise<ExecutionTrace> {
    // Initialize state
    const classification = EnhancedTaskClassifier.classifyTaskEnhanced(content, attachments);
    const selectedModel = 'deepseek-r1-7b'; // In real code, use ModelRouter.selectModel()
    const state: AgentExecutionState = {
      hasReadSkill: false,
      skillsRead: new Map(),
      hasGeneratedArtifact: false,
      stepCount: 0,
      gatesPassed: new Set(),
      gatesFailed: new Set(),
      taskClassification: classification,
    };

    const tracer = new ExecutionTracer('session-123', classification, selectedModel);

    // Log classification
    console.log('📋 Task Classification:', {
      type: classification.type,
      skillsNeeded: classification.skillsNeeded,
      requiresArtifact: classification.requiresArtifact,
    });

    // Main agent loop with gates
    const maxSteps = 32;
    while (state.stepCount < maxSteps) {
      state.stepCount++;
      console.log(`\n🔄 Step ${state.stepCount}/${maxSteps}`);

      // GATE 1: Skill Reading
      if (classification.skillsNeeded.length > 0) {
        const skillGate = SkillReadingGate.checkSkillReadGate(state, classification, tracer.trace.toolCalls);
        tracer.recordGateCheck(state.stepCount, 'skill_read_gate', skillGate.passed, skillGate.message);
        console.log(`  Gate [skill_read]: ${skillGate.passed ? '✓' : '✗'}`);

        if (!skillGate.passed) {
          const injection = SkillReadingGate.generateSkillGateInjection(skillGate.missing);
          console.log(`  → Injecting mandate: ${skillGate.missing.join(', ')}`);
          // In real code: append injection to system prompt and re-invoke LLM
          // This forces the LLM to call search_skills + read_skill
        }
      }

      // GATE 2: Task Completion
      if (classification.requiresArtifact && state.stepCount > 4) {
        const completionGate = TaskCompletionGate.checkTaskCompletion(state, classification, tracer.trace.toolResults);
        tracer.recordGateCheck(state.stepCount, 'task_completion_gate', completionGate.passed, completionGate.message);
        console.log(`  Gate [completion]: ${completionGate.passed ? '✓' : '✗'}`);

        if (!completionGate.passed && completionGate.nextAction) {
          const injection = TaskCompletionGate.generateCompletionInjection(classification, state.artifactPath);
          console.log(`  → Injecting mandate: ${completionGate.nextAction}`);
          // In real code: append injection to system prompt and re-invoke LLM
        }
      }

      // Simulate tool call (in real code, this comes from LLM output)
      const mockToolCall = { name: 'search_skills', args: { query: 'pptx presentation' } };
      tracer.recordToolCall(state.stepCount, mockToolCall.name, mockToolCall.args);
      console.log(`  Tool: ${mockToolCall.name}`);

      // Simulate tool execution
      tracer.recordToolResult(mockToolCall.name, true, '3 skills found: pptx-official, python-pptx-generator, frontend-design');

      // Simulate LLM decision to read skill
      if (state.stepCount === 2) {
        tracer.recordToolCall(state.stepCount, 'read_skill', { skill_name: 'pptx-official' });
        tracer.recordToolResult('read_skill', true, 'SKILL.md content loaded (2200 chars)');
        state.hasReadSkill = true;
        state.skillsRead.set('pptx-official', 'SKILL.md content...');
        tracer.recordSkillRead('pptx-official', '/path/to/pptx-official/SKILL.md');
      }

      // Simulate LLM decision to generate artifact
      if (state.stepCount === 4) {
        tracer.recordToolCall(state.stepCount, 'fs_write', {
          path: './artifacts/presentation.pptx',
          content: 'binary pptx data',
        });
        tracer.recordToolResult('fs_write', true, 'File written: ./artifacts/presentation.pptx (2.3 MB)');
        state.hasGeneratedArtifact = true;
        state.artifactPath = './artifacts/presentation.pptx';
        tracer.recordArtifact('./artifacts/presentation.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2300000);
      }

      // Check for task completion
      if (state.hasGeneratedArtifact || state.stepCount >= 5) {
        console.log(`\n✅ Task Complete`);
        break;
      }
    }

    const finalTrace = tracer.finalize(state.hasGeneratedArtifact || !classification.requiresArtifact);
    console.log(tracer.getFormattedLog());

    return finalTrace;
  }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

async function demonstrateEnhancedOrchestrator() {
  const orchestrator = new EnhancedAgentOrchestrator();

  const trace = await orchestrator.execute(
    'Read this scanned inspection report and draft an approval note as a Word file',
    [{ path: '/uploads/inspection_report.pdf', mimeType: 'application/pdf', name: 'inspection_report.pdf' }]
  );

  console.log('\n📊 Final Audit Report:');
  console.log(`  ✓ Success: ${trace.success}`);
  console.log(`  🎯 Model: ${trace.selectedModel}`);
  console.log(`  📚 Skills Loaded: ${trace.loadedSkills.length}`);
  console.log(`  🔧 Tool Calls: ${trace.toolCalls.length}`);
  console.log(`  🚪 Gate Checks: ${trace.gateChecks.length} (${trace.gateChecks.filter((g) => g.passed).length} passed)`);
  console.log(`  🌐 External Calls: ${trace.networkCalls.filter((n) => !n.blocked).length}`);
  console.log(`  📄 Artifact: ${trace.finalArtifact?.path || '(none)'}`);
}

export default EnhancedAgentOrchestrator;
