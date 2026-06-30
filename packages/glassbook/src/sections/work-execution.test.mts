import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import { runWorkExecution } from './work-execution.mjs';
import { initialState, type RunConfig } from '../types.mjs';
import { UsageMeter } from '../cost.mjs';
import type { SectionContext } from '../context.mjs';
import type { Plan, WorkPlan } from '../schemas.mjs';

const mocks = vi.hoisted(() => ({
  runUlysses: vi.fn(),
  runToolSubagent: vi.fn(),
  isClean: vi.fn(),
  commitAll: vi.fn(),
  sh: vi.fn(),
  detectInstallCommand: vi.fn(),
}));

vi.mock('../epiops/ulysses.mjs', () => ({
  runUlysses: mocks.runUlysses,
}));

vi.mock('../subagent.mjs', () => ({
  MAX_STEPS: {
    planner: 1,
    worker: 30,
    reviewer: 18,
    hypothesis: 12,
  },
  runToolSubagent: mocks.runToolSubagent,
}));

vi.mock('../git.mjs', () => ({
  isClean: mocks.isClean,
  commitAll: mocks.commitAll,
}));

vi.mock('../tools.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tools.mjs')>();
  return {
    ...actual,
    sh: mocks.sh,
    detectInstallCommand: mocks.detectInstallCommand,
  };
});

function makeConfig(repoDir: string = '/tmp/repo'): RunConfig {
  return {
    prompt: 'refactor without changing behavior',
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

function makeContext(process: WorkPlan['process'], repoDir?: string): SectionContext {
  const config = makeConfig(repoDir);
  const state = initialState(config);
  state.workingBranch = 'glassbook/run';
  return {
    config,
    state,
    emitter: {
      evidence: vi.fn(async () => undefined),
      section: vi.fn(async () => undefined),
    } as unknown as SectionContext['emitter'],
    tools: { writeFile: vi.fn() } as unknown as SectionContext['tools'],
    logger: {
      section: vi.fn(),
      step: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
    repoDir: config.repoDir,
    meter: new UsageMeter(),
  };
}

const plan: Plan = {
  goal: 'Preserve behavior while changing internals',
  successCriteria: ['tests pass'],
  finalGates: [{ id: 'tests', description: 'tests pass', command: 'npm test' }],
  assumptions: [],
  risks: [],
};

function makeWorkPlan(process: WorkPlan['process']): WorkPlan {
  return {
    process,
    rationale: 'selected by planner',
    primaryHypothesis: `${process} primary behavior`,
    primaryEvaluator: { id: 'primary', description: 'primary gate', command: 'npm test' },
    backupHypothesis: `${process} backup behavior`,
    backupEvaluator: { id: 'backup', description: 'backup gate', command: 'npm test' },
  };
}

describe('runWorkExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sh.mockResolvedValue({ code: 0, stdout: '', stderr: '', combined: '' });
    mocks.detectInstallCommand.mockReturnValue(undefined);
    mocks.isClean.mockResolvedValue({ ok: true, value: true });
    mocks.commitAll.mockResolvedValue({ ok: true, value: 'commit-hash' });
    mocks.runToolSubagent.mockResolvedValue({
      ok: true,
      value: { text: 'protocol-specific evidence', steps: 1 },
    });
    mocks.runUlysses.mockResolvedValue({
      ok: true,
      value: { desiredStateAchieved: true, evidence: 'ulysses', testOutput: 'PASS' },
    });
  });

  it.each(['theseus', 'hephaestus', 'ariadne'] as const)(
    'dispatches %s to a protocol-specific adapter, not Ulysses',
    async (process) => {
      const ctx = makeContext(process);
      const result = await runWorkExecution(ctx, plan, makeWorkPlan(process));

      expect(result.ok).toBe(true);
      expect(mocks.runUlysses).not.toHaveBeenCalled();
      if (result.ok) {
        expect(result.value.protocol).toBe(process);
        expect(result.value.packet).toMatchObject({ protocol: process });
      }
      expect(ctx.state.execution?.protocol).toBe(process);
    },
  );

  it('preserves Ulysses by delegating to the existing live loop and enriching its packet', async () => {
    const ctx = makeContext('ulysses');
    const result = await runWorkExecution(ctx, plan, makeWorkPlan('ulysses'));

    expect(result.ok).toBe(true);
    expect(mocks.runUlysses).toHaveBeenCalledOnce();
    if (result.ok) {
      expect(result.value.protocol).toBe('ulysses');
      expect(result.value.packet).toMatchObject({
        protocol: 'ulysses',
        packet: 'fix',
        resolved: true,
        objective: plan.goal,
      });
    }
  });

  it('emits a Theseus transformation packet with invariant and rollback metadata', async () => {
    const result = await runWorkExecution(makeContext('theseus'), plan, makeWorkPlan('theseus'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.packet).toMatchObject({
        protocol: 'theseus',
        packet: 'transformation',
        objective: plan.goal,
        invariants: plan.successCriteria,
        evaluatorSuite: ['npm test'],
        equivalent: true,
        rollbackPlan: expect.stringContaining('checkpoint'),
      });
    }
  });

  it('commits verified Hephaestus reproducer reductions before evaluation can inspect them', async () => {
    mocks.isClean.mockResolvedValue({ ok: true, value: false });

    const result = await runWorkExecution(
      makeContext('hephaestus'),
      plan,
      makeWorkPlan('hephaestus'),
    );

    expect(result.ok).toBe(true);
    expect(mocks.commitAll).toHaveBeenCalledWith(
      '/tmp/repo',
      'glassbook(hephaestus): commit verified protocol artifacts',
    );
  });

  it('does not commit after read-only Ariadne topology discovery', async () => {
    mocks.isClean.mockResolvedValue({ ok: true, value: false });

    const result = await runWorkExecution(makeContext('ariadne'), plan, makeWorkPlan('ariadne'));

    expect(result.ok).toBe(true);
    expect(mocks.commitAll).not.toHaveBeenCalled();
  });

  it('emits a Hephaestus reproduction packet with a failure oracle', async () => {
    const result = await runWorkExecution(
      makeContext('hephaestus'),
      plan,
      makeWorkPlan('hephaestus'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.packet).toMatchObject({
        protocol: 'hephaestus',
        packet: 'reproduction',
        targetFailure: plan.goal,
        reproducer: 'npm test',
        failureOracle: 'npm test',
        minimized: true,
      });
    }
    expect(mocks.runToolSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Do not create reproduction packet files'),
        tools: expect.objectContaining({ writeFile: expect.anything() }),
      }),
    );
  });

  it('runs Ariadne with read-only tooling and emits topology metadata', async () => {
    const ctx = makeContext('ariadne');
    const result = await runWorkExecution(ctx, plan, makeWorkPlan('ariadne'));

    expect(result.ok).toBe(true);
    expect(mocks.runToolSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'hypothesis',
        tools: expect.not.objectContaining({ writeFile: expect.anything() }),
      }),
    );
    if (result.ok) {
      expect(result.value.packet).toMatchObject({
        protocol: 'ariadne',
        packet: 'topology',
        targetIntervention: plan.goal,
        contracts: plan.successCriteria,
        recommendedChecks: ['npm test'],
      });
    }
  });

  it('builds Ariadne topology packet nodes and edges from repository files', async () => {
    const repoDir = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-ariadne-packet-'));
    fs.mkdirSync(Path.join(repoDir, 'src'));
    fs.writeFileSync(
      Path.join(repoDir, 'src/api.js'),
      'import { service } from "./service.js"; export function handler() { return service(); }\n',
    );
    fs.writeFileSync(
      Path.join(repoDir, 'src/service.js'),
      'export function service() { return "ok"; }\n',
    );
    fs.writeFileSync(
      Path.join(repoDir, 'test.js'),
      "import('./src/api.js').then(({ handler }) => handler());\n",
    );

    const result = await runWorkExecution(
      makeContext('ariadne', repoDir),
      plan,
      makeWorkPlan('ariadne'),
    );

    fs.rmSync(repoDir, { recursive: true, force: true });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.packet?.protocol === 'ariadne') {
      expect(result.value.packet.nodes).toEqual(
        expect.arrayContaining(['src/api.js', 'src/service.js', 'test.js']),
      );
      expect(result.value.packet.edges).toEqual(
        expect.arrayContaining([
          ['src/api.js', 'src/service.js'],
          ['test.js', 'src/api.js'],
        ]),
      );
    }
  });
});
