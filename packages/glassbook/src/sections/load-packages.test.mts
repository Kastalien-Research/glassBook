import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import { runLoadPackages } from './load-packages.mjs';
import { initialState, type RunConfig } from '../types.mjs';
import { UsageMeter } from '../cost.mjs';
import type { SectionContext } from '../context.mjs';

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function makeRepo(): string {
  const repo = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-load-packages-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(Path.join(repo, 'README.md'), 'initial\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  return repo;
}

function makeContext(repoDir: string, loadPackagesLimit: number): SectionContext {
  const config: RunConfig = {
    prompt: 'p',
    repoDir,
    template: 'codebase-update',
    budgets: {
      loadPackages: { limit: loadPackagesLimit, used: 0 },
      initialize: { limit: 1, used: 0 },
      research: { limit: 1, used: 0 },
      workPlan: { limit: 1, used: 0 },
      workExecution: { limit: 1, used: 0 },
      evaluation: { limit: 1, used: 0 },
    },
    baseBranch: 'main',
    skipPullRequest: true,
    allowInstall: false,
  };
  return {
    config,
    state: initialState(config),
    emitter: { section: vi.fn(async () => undefined) } as unknown as SectionContext['emitter'],
    tools: {} as SectionContext['tools'],
    logger: { section: vi.fn(), success: vi.fn() } as unknown as SectionContext['logger'],
    repoDir,
    meter: new UsageMeter(),
  };
}

describe('runLoadPackages', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('fails before branch creation when the section budget is exhausted', async () => {
    const ctx = makeContext(repoDir, 0);
    const initialBranch = git(repoDir, ['branch', '--show-current']);

    const result = await runLoadPackages(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe('BudgetExceeded');
    expect(git(repoDir, ['branch', '--show-current'])).toBe(initialBranch);
  });

  it('consumes one loadPackages cell on success', async () => {
    const ctx = makeContext(repoDir, 1);

    const result = await runLoadPackages(ctx);

    expect(result.ok).toBe(true);
    expect(ctx.state.budgets.loadPackages.used).toBe(1);
  });
});
