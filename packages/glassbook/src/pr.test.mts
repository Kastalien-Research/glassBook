import { describe, it, expect } from 'vitest';
import { buildPrBody } from './pr.mjs';
import { initialState, type RunConfig, type GlassbookState } from './types.mjs';

function baseState(): GlassbookState {
  const config: RunConfig = {
    prompt: 'fix the flaky test',
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

describe('buildPrBody', () => {
  it('always includes the objective and checkpoint count', () => {
    const s = baseState();
    s.checkpoints = ['abc', 'def'];
    const body = buildPrBody(s);
    expect(body).toContain('**Objective:** fix the flaky test');
    expect(body).toContain('**Checkpoints:** 2');
  });

  it('omits plan/evaluation sections when absent', () => {
    const body = buildPrBody(baseState());
    expect(body).not.toContain('**Goal:**');
    expect(body).not.toContain('**Evaluation:**');
  });

  it('renders plan and evaluation when present', () => {
    const s = baseState();
    s.plan = {
      goal: 'make tests deterministic',
      successCriteria: ['npm test passes 10x'],
      finalGates: [],
      assumptions: [],
      risks: [],
    };
    s.execution = {
      desiredStateAchieved: true,
      evidence: 'ok',
      testOutput: 'PASS',
    };
    s.evaluation = {
      verdict: 'approve',
      rewardHackingDetected: false,
      reasoning: 'genuine fix',
      issues: [],
    };
    const body = buildPrBody(s);
    expect(body).toContain('**Goal:** make tests deterministic');
    expect(body).toContain('desired state achieved = true');
    expect(body).toContain('**Evaluation:** approve (reward hacking: false)');
    expect(body).toContain('genuine fix');
  });
});
