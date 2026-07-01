import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResearch } from './research.mjs';
import { UsageMeter } from '../cost.mjs';
import { initialState, makeError, type RunConfig } from '../types.mjs';
import type { SectionContext } from '../context.mjs';
import type { Plan } from '../schemas.mjs';

const mocks = vi.hoisted(() => ({
  runPlanSubagent: vi.fn(),
  runPlanSubagentDetailed: vi.fn(),
  runToolSubagent: vi.fn(),
}));

vi.mock('../subagent.mjs', () => ({
  runPlanSubagent: mocks.runPlanSubagent,
  runPlanSubagentDetailed: mocks.runPlanSubagentDetailed,
  runToolSubagent: mocks.runToolSubagent,
}));

function makeConfig(): RunConfig {
  return {
    prompt: 'fix slug casing',
    repoDir: '/tmp/repo',
    template: 'codebase-update',
    budgets: {
      loadPackages: { limit: 1, used: 0 },
      initialize: { limit: 1, used: 0 },
      research: { limit: 2, used: 0 },
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
  const state = initialState(config);
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
  goal: 'Fix slug casing while preserving the public API',
  successCriteria: ['npm test passes'],
  finalGates: [{ id: 'tests', description: 'tests pass', command: 'npm test' }],
  assumptions: [],
  risks: [],
};

describe('runResearch recursive context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runToolSubagent.mockResolvedValue({
      ok: true,
      value: {
        text: [
          'src/slugify.mjs currently preserves uppercase letters.',
          'test/slugify.test.mjs expects lowercase output from the npm test gate.',
        ].join('\n'),
        steps: 1,
      },
    });
    mocks.runPlanSubagent.mockImplementation(async ({ schemaName, prompt }) => {
      if (schemaName === 'ResearchQuestions') {
        return {
          ok: true,
          value: {
            questions: ['Which file and gate define the slug casing behavior?'],
          },
        };
      }
      if (schemaName === 'ResearchFindings') {
        return {
          ok: true,
          value: {
            knownBeforeWork: [
              {
                question: 'Which file and gate define the slug casing behavior?',
                answer: prompt.includes('Recursive context answer')
                  ? 'Recursive context identified src/slugify.mjs and npm test.'
                  : 'Only raw investigation text was available.',
                source: 'recursive context over research investigations',
              },
            ],
            unknowableBeforeWork: [],
            summary: prompt,
          },
        };
      }
      throw new Error(`unexpected schema ${schemaName}`);
    });
    mocks.runPlanSubagentDetailed.mockResolvedValue({
      ok: true,
      value: {
        output: {
          answer: 'The key evidence is src/slugify.mjs plus the npm test gate.',
          citationSpanIds: ['research-investigations:L1-L3'],
        },
        usage: { inputTokens: 21, outputTokens: 13, totalTokens: 34 },
      },
    });
  });

  it('records a cited recursive context answer and includes it in synthesis', async () => {
    const ctx = makeContext();
    const result = await runResearch(ctx, plan);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.recursiveContextCalls).toHaveLength(1);
    expect(result.value.glassbookCells).toHaveLength(1);
    expect(result.value.recursiveContextCalls[0]).toMatchObject({
      status: 'ok',
      answer: 'The key evidence is src/slugify.mjs plus the npm test gate.',
      usage: { inputTokens: 21, outputTokens: 13, totalTokens: 34 },
    });
    expect(result.value.recursiveContextCalls[0]?.citations).toHaveLength(1);
    expect(result.value.glassbookCells[0]).toMatchObject({
      section: 'research',
      input: { parentCellId: 'research' },
      output: {
        status: 'ok',
        answer: 'The key evidence is src/slugify.mjs plus the npm test gate.',
      },
    });
    expect(result.value.findings.summary).toContain('Recursive context answer');
    expect(result.value.findings.summary).toContain(
      'The key evidence is src/slugify.mjs plus the npm test gate.',
    );

    const recursiveArgs = mocks.runPlanSubagentDetailed.mock.calls[0]?.[0];
    expect(recursiveArgs).not.toHaveProperty('tools');
    expect(JSON.stringify(recursiveArgs)).not.toContain('writeFile');
    expect(JSON.stringify(recursiveArgs)).not.toContain('execute-code');
    expect(JSON.stringify(recursiveArgs)).not.toContain('mcp__');

    expect(mocks.runToolSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.not.objectContaining({ writeFile: expect.anything() }),
      }),
    );
    expect(ctx.state.recursiveContextCalls).toHaveLength(0);
    expect(ctx.state.glassbookCells).toHaveLength(0);
  });

  it('records recursive subquery failure without failing research synthesis', async () => {
    mocks.runPlanSubagentDetailed.mockResolvedValue({
      ok: false,
      error: makeError('SubagentError', 'recursive model unavailable'),
    });

    const result = await runResearch(makeContext(), plan);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.recursiveContextCalls).toHaveLength(1);
    expect(result.value.recursiveContextCalls[0]).toMatchObject({
      status: 'failed',
      error: 'recursive model unavailable',
    });
    expect(result.value.glassbookCells[0]).toMatchObject({
      section: 'research',
      output: {
        status: 'failed',
        error: 'recursive model unavailable',
      },
    });
    expect(result.value.findings.summary).toContain('Recursive context failed');
  });

  it('fails fast with BudgetExceeded when the research budget is already exhausted', async () => {
    const ctx = makeContext();
    ctx.state.budgets.research.used = ctx.state.budgets.research.limit;

    const result = await runResearch(ctx, plan);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe('BudgetExceeded');
    expect(mocks.runPlanSubagent).not.toHaveBeenCalled();
    expect(mocks.runToolSubagent).not.toHaveBeenCalled();
  });
});
