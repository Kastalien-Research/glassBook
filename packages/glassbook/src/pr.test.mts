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

  it('renders run-derived audit details', () => {
    const s = baseState();
    s.plan = {
      goal: 'make tests deterministic',
      successCriteria: ['tests pass'],
      finalGates: [{ id: 'tests', description: 'test suite', command: 'npm test' }],
      assumptions: ['repo starts clean'],
      risks: ['network unavailable'],
    };
    s.research = {
      knownBeforeWork: [
        { question: 'How to test?', answer: 'Run npm test', source: 'package.json' },
      ],
      unknowableBeforeWork: [],
      summary: 'The package uses npm test.',
    };
    s.execution = {
      desiredStateAchieved: true,
      evidence: 'Resolved after 1 turn.',
      testOutput: 'PASS',
    };
    s.evaluation = {
      verdict: 'approve',
      rewardHackingDetected: false,
      reasoning: 'diff and tests line up',
      issues: [],
    };
    s.usage = {
      totals: { calls: 2, inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      byRole: {},
    };
    s.kernelTurns = [{ turn: 1, fromCheckpoint: 'abc', attempts: [], transition: 'resolved' }];
    s.glassbookCells.push({
      section: 'workExecution',
      input: { behavior: 'fix it' },
      processing: { position: 1 },
      output: { passed: true },
      gates: [{ id: 'tests', description: 'test suite', command: 'npm test' }],
    });

    const body = buildPrBody(s);

    expect(body).toContain('**Final gates:**');
    expect(body).toContain('- `npm test` — test suite');
    expect(body).toContain('**Research summary:** The package uses npm test.');
    expect(body).toContain('**Kernel turns:** 1');
    expect(body).toContain('**Typed cells:** 1');
    expect(body).toContain('**Usage:** 2 call(s), 30 tokens');
  });

  it('renders recursive context call counts when present', () => {
    const s = baseState();
    s.recursiveContextCalls.push({
      parentCellId: 'research-cell',
      depth: 1,
      question: 'What did the prior notebook conclude?',
      refs: [
        {
          id: 'notebook:abc123',
          kind: 'notebook',
          sourcePath: '/tmp/prior.src.md',
          contentHash: 'abc123',
        },
      ],
      selectedSpans: [
        {
          spanId: 'notebook:abc123:L2-L4',
          refId: 'notebook:abc123',
          sourcePath: '/tmp/prior.src.md',
          startLine: 2,
          endLine: 4,
          text: 'Prior conclusion',
        },
      ],
      answer: 'Prior conclusion',
      citations: [
        {
          refId: 'notebook:abc123',
          sourcePath: '/tmp/prior.src.md',
          startLine: 2,
          endLine: 4,
        },
      ],
      status: 'ok',
    });

    const body = buildPrBody(s);

    expect(body).toContain('**Recursive context calls:** 1');
  });

  it('renders protocol packet details when execution emits a packet', () => {
    const s = baseState();
    s.execution = {
      desiredStateAchieved: true,
      evidence: 'Equivalent transformation completed.',
      testOutput: 'PASS',
      protocol: 'theseus',
      packet: {
        protocol: 'theseus',
        packet: 'transformation',
        objective: 'Extract parser state machine',
        invariants: ['public parse output remains unchanged'],
        acceptedChanges: ['internal parser state is explicit'],
        evaluatorSuite: ['npm test'],
        equivalent: true,
        rollbackPlan: 'Revert the protocol branch merge commit.',
        remainingRisks: ['performance was not benchmarked'],
      },
      verification: {
        baselinePassed: true,
        finalPassed: true,
        commands: ['npm test'],
      },
    };

    const body = buildPrBody(s);

    expect(body).toContain('**Protocol:** theseus');
    expect(body).toContain('**Protocol packet:** transformation');
    expect(body).toContain('Extract parser state machine');
    expect(body).toContain('public parse output remains unchanged');
    expect(body).toContain('npm test');
    expect(body).toContain('performance was not benchmarked');
  });
});
