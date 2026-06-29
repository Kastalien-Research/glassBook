import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWorkPlan } from './work-plan.mjs';
import { initialState, type RunConfig } from '../types.mjs';
import { UsageMeter } from '../cost.mjs';
import type { SectionContext } from '../context.mjs';
import type { Plan, ResearchFindings } from '../schemas.mjs';

const mocks = vi.hoisted(() => ({
  runPlanSubagent: vi.fn(),
}));

vi.mock('../subagent.mjs', () => ({
  runPlanSubagent: mocks.runPlanSubagent,
}));

function makeConfig(): RunConfig {
  return {
    prompt: 'refactor without changing behavior',
    repoDir: '/tmp/repo',
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

function makeContext(): SectionContext {
  const config = makeConfig();
  return {
    config,
    state: initialState(config),
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
  goal: 'Refactor parser',
  successCriteria: ['observable behavior remains unchanged'],
  finalGates: [{ id: 'test', description: 'tests pass', command: 'npm test' }],
  assumptions: [],
  risks: [],
};

const research: ResearchFindings = {
  knownBeforeWork: [],
  unknowableBeforeWork: [],
  summary: 'Parser behavior is covered by tests.',
};

describe('runWorkPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runPlanSubagent.mockResolvedValue({
      ok: true,
      value: {
        process: 'theseus',
        rationale: 'behavior-preserving refactor',
        primaryHypothesis: 'extract parser state machine',
        primaryEvaluator: { id: 'tests', description: 'tests pass', command: 'npm test' },
        backupHypothesis: 'extract token normalization first',
        backupEvaluator: { id: 'tests', description: 'tests pass', command: 'npm test' },
      },
    });
  });

  it('passes markdown-derived protocol definitions into the planner prompt', async () => {
    const result = await runWorkPlan(makeContext(), plan, research);

    expect(result.ok).toBe(true);
    expect(mocks.runPlanSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('theseus: Theseus Protocol'),
      }),
    );
    const prompt = mocks.runPlanSubagent.mock.calls[0]?.[0]?.prompt;
    expect(prompt).toContain('Final gates:\n- test: npm test');
    expect(prompt).toContain('entities: stateStep, behaviors, checkpoints');
    expect(prompt).toContain('packet: the transformation objective');
    expect(prompt).toContain('transition:');
  });
});
