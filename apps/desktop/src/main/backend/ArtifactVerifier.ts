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

export async function verifyCodeArtifact(
  path: string,
  spec: ArtifactSpec,
  toolDispatch: (name: string, args: Record<string, unknown>) => Promise<string>
): Promise<VerificationResult> {
  const result = await verifyArtifact(path, spec, toolDispatch);
  if (!result.exists || result.truncated) {
    return result;
  }

  const extMatch = path.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';

  let command = '';
  const escapedPath = path.replace(/\\/g, '/');

  if (ext === 'py') {
    command = `python "${escapedPath}"`;
  } else if (ext === 'js') {
    command = `node "${escapedPath}"`;
  } else if (ext === 'ts') {
    command = `npx tsx "${escapedPath}"`;
  } else if (ext === 'sh') {
    command = `bash "${escapedPath}"`;
  } else if (ext === 'ps1') {
    command = `powershell -File "${escapedPath}"`;
  }

  if (command) {
    try {
      const execOutput = await toolDispatch('shell_exec', { command });
      let stdout = execOutput;
      let stderr = '';
      let exitCode = 0;

      if (execOutput.includes('EXIT CODE:') || execOutput.includes('Error:')) {
        const exitMatch = execOutput.match(/EXIT CODE:\s*(\d+)/i);
        if (exitMatch) {
          exitCode = parseInt(exitMatch[1], 10);
        }
        if (exitCode !== 0) {
          stderr = execOutput;
          result.issues.push(`Execution exited with non-zero code ${exitCode}`);
        }
      }

      result.executionResult = {
        command,
        exitCode,
        stdout,
        stderr,
      };
    } catch (err: any) {
      result.issues.push(`Execution failed: ${err?.message || String(err)}`);
      result.executionResult = {
        command,
        exitCode: 1,
        stdout: '',
        stderr: String(err),
      };
    }
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
