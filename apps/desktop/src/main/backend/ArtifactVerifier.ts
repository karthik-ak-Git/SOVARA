import type { ArtifactSpec } from './ExecutionPlanner'

export interface VerificationResult {
  exists: boolean;
  path: string;
  sizeBytes: number;
  contentValid: boolean;
  structureValid: boolean;
  truncated: boolean;
  issues: string[];
  executionResult?: {
    exitCode: number;
    stdout: string;
    stderr: string;
    command: string;
  };
}

export function shouldAutoVerify(toolName: string, toolArgs: Record<string, unknown>): boolean {
  if (toolName !== 'fs_write') return false;
  const p = typeof toolArgs['path'] === 'string' ? toolArgs['path'] : '';
  if (!p) return false;
  const extMatch = p.match(/\.(html|py|ts|js|jsx|tsx|css|md|json|csv|docx|xlsx|pptx|pdf)$/i);
  return !!extMatch;
}

export async function verifyArtifact(
  path: string,
  spec: ArtifactSpec,
  toolDispatch: (name: string, args: Record<string, unknown>) => Promise<string>
): Promise<VerificationResult> {
  const result: VerificationResult = {
    exists: false,
    path,
    sizeBytes: 0,
    contentValid: false,
    structureValid: false,
    truncated: false,
    issues: [],
  };

  try {
    const rawContent = await toolDispatch('fs_read', { path });
    if (!rawContent || rawContent.startsWith('Error') || rawContent.startsWith('GATE FAILED')) {
      result.issues.push(`Failed to read file: ${rawContent || 'File unreadable'}`);
      return result;
    }

    result.exists = true;
    result.sizeBytes = Buffer.byteLength(rawContent, 'utf-8');

    // Size check
    if (result.sizeBytes < spec.minSizeBytes) {
      result.issues.push(`File size (${result.sizeBytes} bytes) is less than required minimum (${spec.minSizeBytes} bytes)`);
    } else {
      result.contentValid = true;
    }

    // Structure & markers check
    const missingMarkers: string[] = [];
    for (const marker of spec.requiredMarkers) {
      if (!rawContent.includes(marker)) {
        missingMarkers.push(marker);
      }
    }

    if (missingMarkers.length > 0) {
      result.issues.push(`Missing required structural markers: ${missingMarkers.map((m) => `'${m}'`).join(', ')}`);
    } else {
      result.structureValid = true;
    }

    // Truncation check
    const fences = (rawContent.match(/```/g) || []).length;
    if (fences % 2 !== 0) {
      result.truncated = true;
      result.issues.push('Unclosed code fence detected (odd number of ``` fences)');
    }

    if (spec.type === 'html' && !/<\/html\s*>/i.test(rawContent)) {
      result.truncated = true;
      result.issues.push('HTML artifact missing closing </html> tag');
    }

    if ((spec.type === 'py' || spec.type === 'ts' || spec.type === 'js') && result.sizeBytes > 1000 && !rawContent.trim().endsWith('\n') && !/[;}\n]$/.test(rawContent.trim())) {
      result.truncated = true;
      result.issues.push('Code artifact appears truncated at line end');
    }
  } catch (err: any) {
    result.issues.push(`Verification error: ${err?.message || String(err)}`);
  }

  return result;
}

import { executeCodeFile } from './OutputExecutor'

export async function verifyCodeArtifact(
  path: string,
  spec: ArtifactSpec,
  toolDispatch: (name: string, args: Record<string, unknown>) => Promise<string>
): Promise<VerificationResult> {
  const result = await verifyArtifact(path, spec, toolDispatch);
  if (!result.exists || result.truncated) {
    return result;
  }

  try {
    const outcome = await executeCodeFile(path, toolDispatch, {
      sampleInputs: spec.sampleInput ? spec.sampleInput.split('\n') : undefined,
    });

    result.executionResult = {
      command: outcome.commandExecuted,
      exitCode: outcome.exitCode,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
    };

    if (!outcome.success) {
      result.issues.push(`Execution failed (exit code ${outcome.exitCode}): ${outcome.stderr || outcome.error || 'Unknown error'}`);
    }
  } catch (err: any) {
    result.issues.push(`Execution failed: ${err?.message || String(err)}`);
  }

  return result;
}

export function generateVerificationReport(result: VerificationResult): string {
  const statusIcon = result.exists && result.contentValid && result.structureValid && !result.truncated ? '✅ PASSED' : '❌ FAILED';
  const lines = [
    `### Artifact Verification Report — ${statusIcon}`,
    `- **File**: \`${result.path}\``,
    `- **File Exists**: ${result.exists ? 'Yes' : 'No'}`,
    `- **File Size**: ${result.sizeBytes} bytes`,
    `- **Structure Valid**: ${result.structureValid ? 'Yes' : 'No'}`,
    `- **Truncated**: ${result.truncated ? 'YES (Error)' : 'No'}`,
  ];

  if (result.issues.length > 0) {
    lines.push(`- **Issues Identified**:`);
    result.issues.forEach((issue) => lines.push(`  - ⚠️ ${issue}`));
  }

  if (result.executionResult) {
    lines.push(`- **Execution Outcome**:`);
    lines.push(`  - Command: \`${result.executionResult.command}\``);
    lines.push(`  - Exit Code: ${result.executionResult.exitCode}`);
    if (result.executionResult.stdout) {
      const preview = result.executionResult.stdout.slice(0, 300);
      lines.push(`  - Output Preview:\n\`\`\`\n${preview}\n\`\`\``);
    }
  }

  return lines.join('\n');
}
