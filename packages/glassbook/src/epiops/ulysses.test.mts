import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import { runUlysses } from './ulysses.mjs';
import { initialState, type RunConfig } from '../types.mjs';
import { UsageMeter } from '../cost.mjs';
import type { SectionContext } from '../context.mjs';
import type { Plan, WorkPlan } from '../schemas.mjs';

const mocks = vi.hoisted(() => ({
  runToolSubagent: vi.fn(),
  runPlanSubagent: vi.fn(),
}));

vi.mock('../subagent.mjs', () => ({
  MAX_STEPS: {
    planner: 1,
    worker: 30,
    reviewer: 18,
    hypothesis: 12,
  },
  runToolSubagent: mocks.runToolSubagent,
  runPlanSubagent: mocks.runPlanSubagent,
}));

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function makeRepo(): string {
  const repo = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-ulysses-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(Path.join(repo, 'README.md'), 'initial\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['checkout', '-b', 'glassbook/run']);
  return repo;
}

function makeConfig(repoDir: string): RunConfig {
  return {
    prompt: 'make the done file',
    repoDir,
    template: 'codebase-update',
    budgets: {
      loadPackages: { limit: 1, used: 0 },
      initialize: { limit: 1, used: 0 },
      research: { limit: 1, used: 0 },
      workPlan: { limit: 1, used: 0 },
      workExecution: { limit: 2, used: 0 },
      evaluation: { limit: 1, used: 0 },
    },
    baseBranch: 'main',
    skipPullRequest: true,
    allowInstall: false,
  };
}

function makeContext(repoDir: string): SectionContext {
  const config = makeConfig(repoDir);
  const state = initialState(config);
  state.workingBranch = 'glassbook/run';
  const executeCodeCell = vi.fn(async () => ({
    passed: true,
    output: 'notebook cell gate passed\n',
  }));
  return {
    config,
    state,
    emitter: {
      dir: Path.join(repoDir, '.glassbook-notebook'),
      markdown: vi.fn(async () => undefined),
      evidence: vi.fn(async () => undefined),
      section: vi.fn(async () => undefined),
      code: vi.fn(async () => undefined),
    } as unknown as SectionContext['emitter'],
    notebookRuntime: { executeCodeCell },
    tools: {} as SectionContext['tools'],
    logger: {
      section: vi.fn(),
      step: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
    repoDir,
    meter: new UsageMeter(),
  };
}

const plan: Plan = {
  goal: 'Create done.txt',
  successCriteria: ['done.txt exists'],
  finalGates: [
    { id: 'final-done-file', description: 'done.txt exists', command: 'test -f done.txt' },
  ],
  assumptions: [],
  risks: [],
};

const workPlan: WorkPlan = {
  process: 'ulysses',
  rationale: 'test',
  primaryHypothesis: 'create done.txt',
  primaryEvaluator: {
    id: 'behavior-done-file',
    description: 'done.txt exists after primary behavior',
    command: 'test -f done.txt',
  },
  backupHypothesis: 'touch done.txt differently',
  backupEvaluator: {
    id: 'behavior-backup-file',
    description: 'backup.txt exists after backup behavior',
    command: 'test -f backup.txt',
  },
};

describe('runUlysses', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeRepo();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('drives the live protocol through the kernel and persists turn records', async () => {
    mocks.runToolSubagent.mockImplementation(async () => {
      fs.writeFileSync(Path.join(repoDir, 'done.txt'), 'ok\n');
      return { ok: true, value: { text: 'created done.txt', steps: 1 } };
    });

    const ctx = makeContext(repoDir);
    const result = await runUlysses(ctx, plan, workPlan);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.desiredStateAchieved).toBe(true);
    }
    expect(ctx.state.kernelTurns).toHaveLength(1);
    expect(ctx.state.kernelTurns?.[0]?.transition).toBe('resolved');
    expect(ctx.state.forbiddenBehaviors).toEqual([]);
    expect(ctx.state.checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(ctx.state.glassbookCells).toHaveLength(1);
    expect(ctx.state.glassbookCells[0]?.input.behavior).toBe('create done.txt');
    expect(ctx.state.glassbookCells[0]?.processing.position).toBe(1);
    expect(ctx.state.glassbookCells[0]?.output.passed).toBe(true);
    expect(git(repoDir, ['branch', '--list', 'glassbook/run-turn-1'])).toContain(
      'glassbook/run-turn-1',
    );
    expect(git(repoDir, ['branch', '--show-current'])).toBe('glassbook/run');
    expect(git(repoDir, ['log', '--oneline', '--merges', '-1'])).toContain('merge Ulysses turn 1');
    expect(ctx.emitter.evidence).toHaveBeenCalledWith(
      'Step 1 gate',
      'text',
      expect.stringContaining('# gate: behavior-done-file (PASS'),
    );
    expect(ctx.notebookRuntime.executeCodeCell).toHaveBeenCalledWith({
      notebookDir: Path.join(repoDir, '.glassbook-notebook'),
      filename: 'ulysses-step-1-behavior-done-file.ts',
    });
    expect(ctx.emitter.evidence).toHaveBeenCalledWith(
      'Step 1 executable gate cell',
      'text',
      expect.stringContaining('notebook cell gate passed'),
    );
  }, 120_000);
});
