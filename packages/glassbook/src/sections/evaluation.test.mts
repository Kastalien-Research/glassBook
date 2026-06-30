import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runEvaluation } from './evaluation.mjs';
import { initialState, type RunConfig } from '../types.mjs';
import { UsageMeter } from '../cost.mjs';
import type { SectionContext } from '../context.mjs';
import type { ExecutionResult, Plan } from '../schemas.mjs';

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

function makeConfig(): RunConfig {
  return {
    prompt: 'perform a Theseus transformation',
    repoDir: '/tmp/repo',
    template: 'codebase-update',
    budgets: {
      loadPackages: { limit: 1, used: 0 },
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
}

function makeContext(): SectionContext {
  const config = makeConfig();
  const state = initialState(config);
  state.workingBranch = 'glassbook/run';
  state.notebookDir = '/tmp/glassbook-notebook';
  return {
    config,
    state,
    emitter: {
      section: vi.fn(async () => undefined),
    } as unknown as SectionContext['emitter'],
    tools: {} as SectionContext['tools'],
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
  goal: 'refactor add while preserving behavior',
  successCriteria: ['npm test passes'],
  finalGates: [{ id: 'tests', description: 'tests pass', command: 'npm test' }],
  assumptions: [],
  risks: [],
};

const execution: ExecutionResult = {
  desiredStateAchieved: true,
  evidence: 'Theseus transformation completed with packet `transformation`.',
  testOutput: 'PASS',
  protocol: 'theseus',
  packet: {
    protocol: 'theseus',
    packet: 'transformation',
    objective: 'refactor add while preserving behavior',
    invariants: ['npm test passes'],
    acceptedChanges: ['replace direct implementation'],
    evaluatorSuite: ['npm test'],
    equivalent: true,
    rollbackPlan: 'revert checkpoint',
    remainingRisks: [],
  },
  verification: {
    baselinePassed: true,
    finalPassed: true,
    commands: ['npm test'],
  },
};

describe('runEvaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runToolSubagent.mockResolvedValue({
      ok: true,
      value: { text: 'packet and gates reviewed', steps: 1 },
    });
    mocks.runPlanSubagent.mockResolvedValue({
      ok: true,
      value: {
        verdict: 'approve',
        rewardHackingDetected: false,
        reasoning: 'packet and gates line up',
        issues: [],
      },
    });
  });

  it('includes protocol packet evidence in the adversarial review prompt', async () => {
    const result = await runEvaluation(makeContext(), plan, execution);

    expect(result.ok).toBe(true);
    expect(mocks.runToolSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"packet": "transformation"'),
      }),
    );
    expect(mocks.runToolSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('treat this JSON as the emitted sidecar/notebook packet'),
      }),
    );
    expect(mocks.runToolSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          'glassBook sidecar: /tmp/glassbook-notebook/glassbook.json',
        ),
      }),
    );
    expect(mocks.runToolSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          'The target repository is not expected to contain glassbook.json',
        ),
      }),
    );
    expect(mocks.runPlanSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('not a target-repository file'),
      }),
    );
  });
});
