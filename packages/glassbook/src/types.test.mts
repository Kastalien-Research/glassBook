import { describe, it, expect } from 'vitest';
import { ok, err, isOk, makeError, initialState, type RunConfig } from './types.mjs';

describe('Result helpers', () => {
  it('ok wraps a value and is recognized by isOk', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(isOk(r)).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err wraps an error and is not ok', () => {
    const r = err(makeError('GitError', 'boom'));
    expect(r.ok).toBe(false);
    expect(isOk(r)).toBe(false);
    if (!r.ok) {
      expect(r.error._tag).toBe('GitError');
      expect(r.error.message).toBe('boom');
    }
  });

  it('makeError carries an optional cause', () => {
    const cause = new Error('underlying');
    const e = makeError('SubagentError', 'failed', cause);
    expect(e._tag).toBe('SubagentError');
    expect(e.cause).toBe(cause);
  });
});

describe('initialState', () => {
  const config: RunConfig = {
    prompt: 'fix the bug',
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

  it('copies the load-bearing config fields', () => {
    const s = initialState(config);
    expect(s.prompt).toBe('fix the bug');
    expect(s.repoDir).toBe('/tmp/repo');
    expect(s.template).toBe('codebase-update');
    expect(s.budgets).toBe(config.budgets);
  });

  it('starts with empty checkpoints and failures', () => {
    const s = initialState(config);
    expect(s.checkpoints).toEqual([]);
    expect(s.failures).toEqual([]);
    expect(s.plan).toBeUndefined();
    expect(s.workingBranch).toBeUndefined();
  });
});
