import fs from 'node:fs/promises';
import Path from 'node:path';

export interface NotebookRuntimeProcessResult {
  readonly code: number;
  readonly output: string;
}

export interface NotebookRuntimeRunRequest {
  readonly cwd: string;
  readonly entry: string;
  readonly env: NodeJS.ProcessEnv;
}

export type NotebookRuntimeInstaller = (
  notebookDir: string,
) => Promise<NotebookRuntimeProcessResult>;

export type NotebookRuntimeRunner = (
  request: NotebookRuntimeRunRequest,
) => Promise<NotebookRuntimeProcessResult>;

export interface NotebookRuntimeReady {
  readonly installed: boolean;
  readonly output: string;
}

export interface NotebookCellResult {
  readonly passed: boolean;
  readonly output: string;
}

const REQUIRED_NOTEBOOK_FILES = ['package.json', 'tsconfig.json'] as const;

export function notebookCodeCellPath(notebookDir: string, filename: string): string {
  return Path.join(notebookDir, 'src', filename);
}

export async function ensureNotebookRuntime(args: {
  readonly notebookDir: string;
  readonly installer?: NotebookRuntimeInstaller;
}): Promise<NotebookRuntimeReady> {
  await assertNotebookRuntimeFiles(args.notebookDir);

  if (await exists(tsxBinaryPath(args.notebookDir))) {
    return { installed: false, output: '' };
  }

  const installer = args.installer ?? npmInstallPromise;
  const installed = await installer(args.notebookDir);
  if (installed.code !== 0) {
    throw new Error(
      [
        `Failed to install notebook runtime dependencies in ${args.notebookDir}.`,
        'Suggested fix: open the notebook package.json cell and verify it can install.',
        installed.output.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return { installed: true, output: installed.output };
}

export async function executeNotebookCodeCell(args: {
  readonly notebookDir: string;
  readonly filename: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly installer?: NotebookRuntimeInstaller;
  readonly runner?: NotebookRuntimeRunner;
}): Promise<NotebookCellResult> {
  await ensureNotebookRuntime({
    notebookDir: args.notebookDir,
    installer: args.installer,
  });

  const entry = notebookCodeCellPath(args.notebookDir, args.filename);
  if (!(await exists(entry))) {
    throw new Error(`Notebook code cell file does not exist: ${entry}`);
  }

  const runner = args.runner ?? tsxPromise;
  const result = await runner({
    cwd: args.notebookDir,
    entry,
    env: args.env ?? {},
  });

  return {
    passed: result.code === 0,
    output: result.output,
  };
}

function tsxBinaryPath(notebookDir: string): string {
  return Path.join(notebookDir, 'node_modules', '.bin', 'tsx');
}

async function assertNotebookRuntimeFiles(notebookDir: string): Promise<void> {
  for (const filename of REQUIRED_NOTEBOOK_FILES) {
    const path = Path.join(notebookDir, filename);
    if (!(await exists(path))) {
      throw new Error(`Notebook runtime file is missing: ${path}`);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function npmInstallPromise(notebookDir: string): Promise<NotebookRuntimeProcessResult> {
  return new Promise((resolve, reject) => {
    let output = '';
    void import('@srcbook/api/headless')
      .then(({ npmInstall }) => {
        npmInstall({
          cwd: notebookDir,
          stdout: (data) => {
            output += data.toString('utf8');
          },
          stderr: (data) => {
            output += data.toString('utf8');
          },
          onExit: (code) => {
            resolve({ code: code ?? 1, output });
          },
          onError: reject,
        });
      })
      .catch(reject);
  });
}

function tsxPromise(request: NotebookRuntimeRunRequest): Promise<NotebookRuntimeProcessResult> {
  return new Promise((resolve, reject) => {
    let output = '';
    void import('@srcbook/api/headless')
      .then(({ tsx }) => {
        tsx({
          cwd: request.cwd,
          env: request.env,
          entry: request.entry,
          stdout: (data) => {
            output += data.toString('utf8');
          },
          stderr: (data) => {
            output += data.toString('utf8');
          },
          onExit: (code) => {
            resolve({ code: code ?? 1, output });
          },
          onError: reject,
        });
      })
      .catch(reject);
  });
}
