import type { TaskClassification } from '@shared/types/task';
import type { CompletionPolicy, TaskIntent } from './TaskClassifier';

export interface ExecutionPlan {
  taskId: string;
  intent: string;
  steps: ExecutionStep[];
  skillsToRead: string[];
  expectedArtifacts: ArtifactSpec[];
  verification: VerificationSpec;
  totalEstimatedSteps: number;
}

export interface ExecutionStep {
  order: number;
  action: 'search_skill' | 'read_skill' | 'analyze' | 'plan' | 'generate' | 'write_file' | 'read_back' | 'execute' | 'validate' | 'report';
  description: string;
  tool?: string;
  args?: Record<string, unknown>;
  dependsOn?: number[];
  verification?: string;
  optional?: boolean;
}

export interface ArtifactSpec {
  fileName: string;
  type: 'html' | 'py' | 'ts' | 'js' | 'pptx' | 'docx' | 'xlsx' | 'pdf' | 'md' | 'csv' | 'json';
  minSizeBytes: number;
  requiredMarkers: string[];
  sampleInput?: string;
}

export interface VerificationSpec {
  readBack: boolean;
  execute: boolean;
  validateStructure: boolean;
  compareOutput: boolean;
}

function detectArtifactName(content: string, defaultName: string): string {
  const match = content.match(/[\w-]+\.(html|py|ts|js|pptx|docx|xlsx|pdf|md|csv|json)/i);
  return match ? match[0] : defaultName;
}

/**
 * Generates an execution plan based on task classification and content.
 * @param classification The task classification result.
 * @param content The user request content.
 * @param hints Optional hints for planning.
 * @returns A structured execution plan.
 */
export function generateExecutionPlan(
  classification: TaskClassification,
  content: string,
  hints?: Record<string, any>
): ExecutionPlan {
  const steps: ExecutionStep[] = [];
  let order = 1;

  const addStep = (step: Omit<ExecutionStep, 'order'>) => {
    steps.push({ ...step, order: order++ });
  };

  const expectedArtifacts: ArtifactSpec[] = [];
  const verification: VerificationSpec = {
    readBack: false,
    execute: false,
    validateStructure: false,
    compareOutput: false,
  };

  const skillsToRead: string[] = [];

  // Multimodal needs analysis
  if (classification.needsMultimodal || classification.requiresVision) {
    addStep({ action: 'analyze', description: 'Analyze the provided image/multimodal input' });
  }

  if (classification.requiresArtifact) {
    let artifactType = classification.artifactType || 'code';
    
    // Artifact type inference based on content if missing
    if (artifactType === 'code' && content.toLowerCase().includes('python')) artifactType = 'code';

    addStep({ action: 'search_skill', description: `Search for ${artifactType} specific skills` });
    skillsToRead.push(`${artifactType}-official`);
    addStep({ action: 'read_skill', description: `Read the ${artifactType}-official skill`, dependsOn: [order - 1] });
    addStep({ action: 'plan', description: `Plan the structure of the ${artifactType} artifact` });
    addStep({ action: 'generate', description: `Generate the content for the artifact` });
    addStep({ action: 'write_file', description: 'Write the generated content to a file' });
    addStep({ action: 'read_back', description: 'Read back the file to verify its contents' });
    
    verification.readBack = true;
    verification.validateStructure = true;
    
    let requiredMarkers: string[] = [];
    let fileName = 'output.md';
    let type: ArtifactSpec['type'] = 'md';
    let minSize = 100;

    if (artifactType === 'pptx') {
      fileName = detectArtifactName(content, 'presentation.html');
      type = 'html';
      requiredMarkers = ['</html>', '<section'];
      minSize = 2048;
    } else if (artifactType === 'docx') {
      fileName = detectArtifactName(content, 'document.html');
      type = 'html';
      requiredMarkers = ['</html>'];
    } else if (artifactType === 'xlsx') {
      fileName = detectArtifactName(content, 'spreadsheet.html');
      type = 'html'; // or py depending on SOVARA convention
      requiredMarkers = ['</table>', '<tr>'];
    } else if (artifactType === 'code') {
      if (content.toLowerCase().includes('python')) {
        fileName = detectArtifactName(content, 'script.py');
        type = 'py';
        requiredMarkers = ['import'];
        addStep({ action: 'execute', description: 'Execute the code to verify it works' });
        verification.execute = true;
      } else {
        fileName = detectArtifactName(content, 'script.ts');
        type = 'ts';
      }
    }

    addStep({ action: 'validate', description: 'Validate the generated artifact structure' });
    
    expectedArtifacts.push({
      fileName,
      type,
      minSizeBytes: minSize,
      requiredMarkers
    });
  } else if (classification.kind === 'tool-use') {
    addStep({ action: 'plan', description: 'Plan tool invocations' });
    if (content.toLowerCase().includes('read') || content.toLowerCase().includes('file')) {
      addStep({ action: 'analyze', description: 'Analyze file system structure' });
    }
    addStep({ action: 'execute', description: 'Execute necessary tools' });
  } else if (classification.kind === 'chat') {
    // Minimal plan for simple chat
  }

  // Always end with a report
  addStep({ action: 'report', description: 'Report completion and findings back to the user' });

  return {
    taskId: hints?.taskId || `task-${Date.now()}`,
    intent: classification.reason || 'Execute task based on user request',
    steps,
    skillsToRead,
    expectedArtifacts,
    verification,
    totalEstimatedSteps: steps.length,
  };
}

/**
 * Converts an execution plan into a prompt directive string.
 * @param plan The execution plan to format.
 * @returns A string suitable for system prompt injection.
 */
export function planToPromptDirective(plan: ExecutionPlan): string {
  let prompt = `[EXECUTION PLAN — Follow these steps in order]\n`;
  
  for (const step of plan.steps) {
    prompt += `Step ${step.order} (${step.action}): ${step.description}\n`;
  }

  if (plan.expectedArtifacts.length > 0) {
    prompt += `\n[Expected Artifacts: `;
    const artifactsStr = plan.expectedArtifacts.map(a => `${a.fileName} (${a.type.toUpperCase()}, min ${a.minSizeBytes} bytes)`).join(', ');
    prompt += artifactsStr + `]\n`;
  }

  const v = plan.verification;
  prompt += `[Verification: read-back=${v.readBack}, execute=${v.execute}, validate-structure=${v.validateStructure}]`;

  return prompt;
}
