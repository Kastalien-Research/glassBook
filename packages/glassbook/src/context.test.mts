import { describe, it, expect } from 'vitest';
import { budgetRemaining, consumeBudget } from './context.mjs';
import { initialState, type RunConfig, type GlassbookState } from './types.mjs';

function makeState(): GlassbookState {
  const config: RunConfig = {
    prompt: 'p',
    repoDir: '/tmp/repo',
    template: 'codebase-update',
    budgets: {
      loadPackages: { limit: 1, used: 0 },
      initialize: { limit: 1, used: 0 },
      research: { limit: 4, used: 0 },
      workPlan: { limit: 1, used: 0 },
      workExecution: { limit: 6, used: 0 },
      evaluation: { limit: 2, used: 0 },
    },
    baseBranch: 'main',
    skipPullRequest: false,
    allowInstall: false,
  };
  return initialState(config);
}

describe('budgetRemaining', () => {
  it('returns limit minus used', () => {
    const s = makeState();
    expect(budgetRemaining(s, 'research')).toBe(4);
    s.budgets.research.used = 3;
    expect(budgetRemaining(s, 'research')).toBe(1);
  });
});

describe('consumeBudget', () => {
  it('decrements remaining and reports ok', () => {
    const s = makeState();
    const r = consumeBudget(s, 'research', 2);
    expect(r.ok).toBe(true);
    expect(s.budgets.research.used).toBe(2);
    expect(budgetRemaining(s, 'research')).toBe(2);
  });

  it('defaults to consuming one cell', () => {
    const s = makeState();
    consumeBudget(s, 'workExecution');
    expect(s.budgets.workExecution.used).toBe(1);
  });

  it('fails with BudgetExceeded when over the limit and does not mutate', () => {
    const s = makeState();
    const r = consumeBudget(s, 'initialize', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error._tag).toBe('BudgetExceeded');
    expect(s.budgets.initialize.used).toBe(0);
  });
});
