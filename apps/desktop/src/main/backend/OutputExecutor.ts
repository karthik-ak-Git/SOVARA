export interface ExecutionOptions {
  timeoutMs?: number;
  sampleInputs?: string[];
  cwd?: string;
}

export interface CodeExecutionOutcome {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  commandExecuted: string;
  matchedExpectedOutput?: boolean;
  error?: string;
}

export async function executeCodeFile(
  filePath: string,
  toolDispatch: (name: string, args: Record<string, unknown>) => Promise<string>,
  options?: ExecutionOptions
): Promise<CodeExecutionOutcome> {
  const normPath = filePath.replace(/\\/g, '/');
  const extMatch = normPath.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';

  let runner = '';
  if (ext === 'py') runner = 'python';
  else if (ext === 'js') runner = 'node';
  else if (ext === 'ts') runner = 'npx tsx';
  else if (ext === 'sh') runner = 'bash';
  else if (ext === 'ps1') runner = 'powershell -File';
  else {
    return {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      commandExecuted: '',
      error: `Unsupported file extension for code execution: .${ext}`,
    };
  }

  let command = `${runner} "${normPath}"`;
  
  if (options?.sampleInputs && options.sampleInputs.length > 0) {
    const inputPipe = options.sampleInputs.map((i) => `"${i.replace(/"/g, '\\"')}"`).join('\n');
    command = `echo ${inputPipe} | ${command}`;
  }

  try {
    const rawOutput = await toolDispatch('shell_exec', { command, timeout: options?.timeoutMs || 30000 });
    const exitMatch = rawOutput.match(/EXIT CODE:\s*(\d+)/i);
    const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;
    const isSuccess = exitCode === 0 && !/^\s*error\s*:/i.test(rawOutput);

    return {
      success: isSuccess,
      exitCode,
      stdout: rawOutput,
      stderr: exitCode !== 0 ? rawOutput : '',
      commandExecuted: command,
    };
  } catch (err: any) {
    return {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: String(err),
      commandExecuted: command,
      error: String(err),
    };
  }
}
