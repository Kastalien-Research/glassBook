import type { Behavior, BehaviorPosition } from './behavior.mjs';
import { type EvaluationResult, isResolving } from './evaluation.mjs';
import { ForbiddenStore } from './forbidden.mjs';

/**
 * One attempt within a turn: the behavior run at a position and its result.
 */
export interface Attempt {
  readonly position: BehaviorPosition;
  readonly behavior: Behavior;
  readonly result: EvaluationResult;
}

export interface TurnRecord {
  readonly turn: number;
  readonly fromCheckpoint: string;
  readonly attempts: Attempt[];
  readonly transition: 'resolved' | 'consideration';
  /** Set when transition === 'consideration'. */
  readonly considerationHypothesis?: string;
}

/**
 * All side effects the loop needs, injected so the loop itself is pure and
 * deterministically testable. A `ProtocolDefinition` + a `World` adapter supply
 * these in the real engine; tests supply fakes.
 */
export interface GamespaceHooks {
  /** Snapshot the world; returns the checkpoint ref (e.g. a commit hash). */
  checkpoint(): Promise<string>;
  /** Restore the world to a checkpoint (e.g. git reset --hard). */
  restore(ref: string): Promise<void>;
  /** Plot the primary + backup behaviors for a turn, honoring the forbidden set. */
  plot(args: {
    turn: number;
    fromCheckpoint: string;
    forbidden: ForbiddenStore;
  }): Promise<{ primary: Behavior; backup: Behavior }>;
  /** Run a behavior's action and evaluate it. */
  execute(behavior: Behavior): Promise<EvaluationResult>;
  /** Reflect on a double failure; returns the CONSIDERATION hypothesis. */
  consider(record: TurnRecord): Promise<{ hypothesis: string }>;
  /** Turns remaining in the budget. */
  budgetRemaining(): number;
  /** Optional observability hook. */
  onEvent?(event: KernelEvent): void;
}

export type KernelEvent =
  | { type: 'turn-start'; turn: number; fromCheckpoint: string }
  | { type: 'attempt'; turn: number; position: BehaviorPosition; outcome: string }
  | { type: 'resolved'; turn: number; checkpoint: string }
  | { type: 'consideration'; turn: number; hypothesis: string };

export interface GamespaceRunResult {
  readonly resolved: boolean;
  readonly turns: TurnRecord[];
  readonly checkpoints: string[];
  readonly forbidden: ForbiddenStore;
}

/**
 * Run the EpiOps gamespace loop. Protocol-agnostic: it knows nothing about
 * codebases, git, or LLMs — only the state machine, checkpoints, and positional
 * forbidding. Drives turns until a behavior resolves the objective or the turn
 * budget is exhausted.
 */
export async function runGamespace(hooks: GamespaceHooks): Promise<GamespaceRunResult> {
  const forbidden = new ForbiddenStore();
  const checkpoints: string[] = [];
  const turns: TurnRecord[] = [];

  const baseline = await hooks.checkpoint();
  checkpoints.push(baseline);
  let lastCheckpoint = baseline;
  let resolved = false;
  let turn = 0;

  while (!resolved && hooks.budgetRemaining() > 0) {
    turn += 1;
    const turnStart = lastCheckpoint;
    hooks.onEvent?.({ type: 'turn-start', turn, fromCheckpoint: turnStart });

    const { primary, backup } = await hooks.plot({ turn, fromCheckpoint: turnStart, forbidden });
    const attempts: Attempt[] = [];

    let banked = false;
    for (const behavior of [primary, backup] as const) {
      const result = await hooks.execute(behavior);
      attempts.push({ position: behavior.position, behavior, result });
      hooks.onEvent?.({
        type: 'attempt',
        turn,
        position: behavior.position,
        outcome: result.outcome,
      });
      if (isResolving(result.outcome)) {
        const cp = await hooks.checkpoint();
        checkpoints.push(cp);
        lastCheckpoint = cp;
        turns.push({ turn, fromCheckpoint: turnStart, attempts, transition: 'resolved' });
        hooks.onEvent?.({ type: 'resolved', turn, checkpoint: cp });
        resolved = true;
        banked = true;
        break;
      }
    }
    if (banked) break;

    // CONSIDERATION (state step -1): forbid the failed pair positionally from
    // this checkpoint, reflect, then reset to the checkpoint and loop.
    for (const behavior of [primary, backup] as const) {
      forbidden.forbid({
        fromCheckpoint: turnStart,
        position: behavior.position,
        signature: behavior.signature,
        reason: `failed at step ${behavior.position} of turn ${turn}`,
      });
    }
    const record: TurnRecord = {
      turn,
      fromCheckpoint: turnStart,
      attempts,
      transition: 'consideration',
    };
    const considered = await hooks.consider(record);
    turns.push({ ...record, considerationHypothesis: considered.hypothesis });
    hooks.onEvent?.({ type: 'consideration', turn, hypothesis: considered.hypothesis });
    await hooks.restore(turnStart);
  }

  return { resolved, turns, checkpoints, forbidden };
}
