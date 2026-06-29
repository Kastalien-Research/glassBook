import { describe, it, expect } from 'vitest';
import { runGamespace, type GamespaceHooks, type KernelEvent } from './run.mjs';
import { makeBehavior } from './behavior.mjs';
import type { EvaluationOutcome } from './evaluation.mjs';

/**
 * Build fake hooks driven by a per-turn script of [primaryOutcome, backupOutcome].
 * Checkpoints are 'cp0' (baseline), 'cp1', ... Tracks restores, execute count,
 * and emitted events so the loop's behavior is fully observable.
 */
function harness(script: EvaluationOutcome[][], maxTurns = script.length + 2) {
  let remaining = maxTurns;
  let cpCounter = 0;
  let currentTurn = 0;
  let executeCount = 0;
  const restores: string[] = [];
  const events: KernelEvent[] = [];

  const hooks: GamespaceHooks = {
    checkpoint: async () => `cp${cpCounter++}`,
    restore: async (ref) => {
      restores.push(ref);
    },
    plot: async ({ turn }) => {
      currentTurn = turn;
      remaining -= 1;
      return {
        primary: makeBehavior({
          id: `t${turn}p1`,
          position: 1,
          intent: `primary ${turn}`,
          evaluatorDescription: 'gate',
        }),
        backup: makeBehavior({
          id: `t${turn}p2`,
          position: 2,
          intent: `backup ${turn}`,
          evaluatorDescription: 'gate',
        }),
      };
    },
    execute: async (behavior) => {
      executeCount += 1;
      const outcome = script[currentTurn - 1]?.[behavior.position - 1] ?? 'failure';
      return { outcome, evidence: `${behavior.id}=${outcome}` };
    },
    consider: async () => ({ hypothesis: `why turn ${currentTurn} failed` }),
    budgetRemaining: () => remaining,
    onEvent: (e) => events.push(e),
  };

  return { hooks, getRestores: () => restores, getExecuteCount: () => executeCount, events };
}

describe('runGamespace', () => {
  it('banks the turn when the primary resolves; backup is not executed', async () => {
    const h = harness([['success', 'failure']]);
    const result = await runGamespace(h.hooks);

    expect(result.resolved).toBe(true);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].transition).toBe('resolved');
    expect(h.getExecuteCount()).toBe(1); // backup skipped
    expect(result.checkpoints).toEqual(['cp0', 'cp1']); // baseline + resolve
    expect(result.forbidden.size).toBe(0);
  });

  it('escalates to the backup and banks it when the primary fails', async () => {
    const h = harness([['failure', 'success']]);
    const result = await runGamespace(h.hooks);

    expect(result.resolved).toBe(true);
    expect(h.getExecuteCount()).toBe(2);
    expect(result.turns[0].attempts.map((a) => a.position)).toEqual([1, 2]);
    expect(result.forbidden.size).toBe(0);
  });

  it('enters CONSIDERATION on a double failure, forbids both positionally, then recovers', async () => {
    const h = harness([
      ['failure', 'failure'],
      ['success', 'failure'],
    ]);
    const result = await runGamespace(h.hooks);

    expect(result.resolved).toBe(true);
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].transition).toBe('consideration');
    expect(result.turns[0].considerationHypothesis).toContain('why turn 1 failed');
    expect(result.turns[1].transition).toBe('resolved');

    // both turn-1 behaviors forbidden from the turn-1 checkpoint (baseline cp0)
    expect(result.forbidden.size).toBe(2);
    const p1 = makeBehavior({
      id: 'x',
      position: 1,
      intent: 'primary 1',
      evaluatorDescription: 'gate',
    });
    const p2 = makeBehavior({
      id: 'x',
      position: 2,
      intent: 'backup 1',
      evaluatorDescription: 'gate',
    });
    expect(result.forbidden.isForbidden('cp0', 1, p1.signature)).toBe(true);
    expect(result.forbidden.isForbidden('cp0', 2, p2.signature)).toBe(true);
    // wrong position is not forbidden
    expect(result.forbidden.isForbidden('cp0', 2, p1.signature)).toBe(false);

    // restored to the turn-1 checkpoint before retrying
    expect(h.getRestores()).toEqual(['cp0']);
  });

  it('stops unresolved when the turn budget is exhausted', async () => {
    const h = harness(
      [
        ['failure', 'failure'],
        ['failure', 'failure'],
        ['failure', 'failure'],
      ],
      3,
    );
    const result = await runGamespace(h.hooks);

    expect(result.resolved).toBe(false);
    expect(result.turns).toHaveLength(3);
    expect(result.turns.every((t) => t.transition === 'consideration')).toBe(true);
    expect(result.forbidden.size).toBe(6); // 2 per turn × 3
    expect(h.getRestores()).toHaveLength(3);
  });

  it('emits lifecycle events', async () => {
    const h = harness([['success', 'failure']]);
    await runGamespace(h.hooks);
    const types = h.events.map((e) => e.type);
    expect(types).toContain('turn-start');
    expect(types).toContain('attempt');
    expect(types).toContain('resolved');
  });
});
