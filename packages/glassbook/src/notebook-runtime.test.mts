import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import Path from 'node:path';
import {
  executeNotebookCodeCell,
  ensureNotebookRuntime,
  notebookCodeCellPath,
  type NotebookRuntimeRunner,
} from './notebook-runtime.mjs';

async function makeNotebook(): Promise<string> {
  const dir = await fs.mkdtemp(Path.join(os.tmpdir(), 'glassbook-notebook-runtime-'));
  await fs.mkdir(Path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(Path.join(dir, 'package.json'), '{"type":"module"}\n', 'utf8');
  await fs.writeFile(Path.join(dir, 'tsconfig.json'), '{}\n', 'utf8');
  return dir;
}

async function markTsxInstalled(notebookDir: string): Promise<void> {
  const binDir = Path.join(notebookDir, 'node_modules', '.bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(Path.join(binDir, 'tsx'), '#!/bin/sh\n', 'utf8');
}

describe('notebook runtime', () => {
  it('resolves code cells the same way Srcbook stores them', async () => {
    const notebookDir = await makeNotebook();

    expect(notebookCodeCellPath(notebookDir, 'gate.ts')).toBe(
      Path.join(notebookDir, 'src', 'gate.ts'),
    );
  });

  it('installs the notebook runtime from package.json when tsx is missing', async () => {
    const notebookDir = await makeNotebook();
    const installer = vi.fn(async () => ({ code: 0, output: 'installed\n' }));

    const result = await ensureNotebookRuntime({ notebookDir, installer });

    expect(result).toEqual({ installed: true, output: 'installed\n' });
    expect(installer).toHaveBeenCalledWith(notebookDir);
  });

  it('fails clearly when the notebook tsconfig is missing', async () => {
    const notebookDir = await makeNotebook();
    await fs.rm(Path.join(notebookDir, 'tsconfig.json'));

    await expect(ensureNotebookRuntime({ notebookDir })).rejects.toThrow(
      `Notebook runtime file is missing: ${Path.join(notebookDir, 'tsconfig.json')}`,
    );
  });

  it('fails clearly when notebook dependency installation fails', async () => {
    const notebookDir = await makeNotebook();
    const installer = vi.fn(async () => ({ code: 1, output: 'registry unavailable\n' }));

    await expect(ensureNotebookRuntime({ notebookDir, installer })).rejects.toThrow(
      'Failed to install notebook runtime dependencies',
    );
  });

  it('runs a code cell through the notebook-local TypeScript runner', async () => {
    const notebookDir = await makeNotebook();
    await markTsxInstalled(notebookDir);
    await fs.writeFile(notebookCodeCellPath(notebookDir, 'gate.ts'), 'console.log("ok");\n');
    const runner: NotebookRuntimeRunner = vi.fn(async ({ cwd, entry }) => ({
      code: 0,
      output: `cwd=${cwd}\nentry=${entry}\n`,
    }));

    const result = await executeNotebookCodeCell({
      notebookDir,
      filename: 'gate.ts',
      runner,
    });

    expect(result.passed).toBe(true);
    expect(result.output).toContain(`cwd=${notebookDir}`);
    expect(result.output).toContain(`entry=${notebookCodeCellPath(notebookDir, 'gate.ts')}`);
  });

  it('returns failed cell output instead of hiding execution failures', async () => {
    const notebookDir = await makeNotebook();
    await markTsxInstalled(notebookDir);
    await fs.writeFile(notebookCodeCellPath(notebookDir, 'gate.ts'), 'throw new Error("nope");\n');
    const runner: NotebookRuntimeRunner = vi.fn(async () => ({
      code: 1,
      output: 'Error: nope\n',
    }));

    const result = await executeNotebookCodeCell({
      notebookDir,
      filename: 'gate.ts',
      runner,
    });

    expect(result.passed).toBe(false);
    expect(result.output).toBe('Error: nope\n');
  });
});
