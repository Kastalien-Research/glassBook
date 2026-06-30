import { describe, expect, it } from 'vitest';
import { initialState, makeError } from './types.mjs';
import { formatRunSummary } from './cli-output.mjs';
import type { RunResult } from './orchestrator.mjs';

function result(overrides: Partial<RunResult> = {}): RunResult {
  const state = initialState({
    prompt: 'do work',
    repoDir: '/tmp/repo',
    template: 'codebase-update',
    budgets: {
      loadPackages: { used: 0, limit: 1 },
      initialize: { used: 0, limit: 1 },
      research: { used: 0, limit: 1 },
      workPlan: { used: 0, limit: 1 },
      workExecution: { used: 0, limit: 1 },
      evaluation: { used: 0, limit: 1 },
    },
    baseBranch: 'main',
    skipPullRequest: true,
    allowInstall: false,
  });
  return {
    ok: true,
    notebookDir: '/tmp/notebook',
    srcmdPath: '/tmp/out.src.md',
    state,
    ...overrides,
  };
}

describe('formatRunSummary', () => {
  it('prints a quiet-mode success summary with the saved artifacts', () => {
    expect(formatRunSummary(result())).toBe(
      ['Status: approved', 'Notebook: /tmp/notebook', 'Exported: /tmp/out.src.md'].join('\n'),
    );
  });

  it('prints the last typed failure for quiet-mode failures', () => {
    const state = initialState({
      prompt: 'do work',
      repoDir: '/tmp/repo',
      template: 'codebase-update',
      budgets: {
        loadPackages: { used: 0, limit: 1 },
        initialize: { used: 0, limit: 1 },
        research: { used: 0, limit: 1 },
        workPlan: { used: 0, limit: 1 },
        workExecution: { used: 0, limit: 1 },
        evaluation: { used: 0, limit: 1 },
      },
      baseBranch: 'main',
      skipPullRequest: true,
      allowInstall: false,
    });
    state.failures.push(makeError('EvaluationRejected', 'review did not approve'));

    expect(formatRunSummary(result({ ok: false, state }))).toContain(
      'Failure: EvaluationRejected: review did not approve',
    );
  });
});
