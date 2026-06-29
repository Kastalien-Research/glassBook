import type { BehaviorPosition } from './state-machine.mjs';
import type { EvaluationOutcome } from './evaluation.mjs';

/**
 * An immutable commitment plotted for a turn: an action (described by intent)
 * plus the evaluator that grades it. The `signature` is a stable hash used to
 * forbid a failed behavior *positionally* from a checkpoint after CONSIDERATION.
 */
export interface Behavior {
  readonly id: string;
  readonly position: BehaviorPosition;
  /** Natural-language description of the action ("the what"). */
  readonly intent: string;
  /** What success means for this behavior (the per-behavior gate). */
  readonly evaluatorDescription: string;
  /** Stable signature for positional forbidding. */
  readonly signature: string;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Deterministic, order-stable signature (djb2). Stable enough that "the same
 * behavior in the same position" is reliably detected, while tolerating
 * whitespace/case differences so trivial rewording does not defeat forbidding.
 */
export function behaviorSignature(intent: string, evaluatorDescription: string): string {
  const input = `${normalize(intent)}::${normalize(evaluatorDescription)}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  // >>> 0 coerces to an unsigned 32-bit int.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function makeBehavior(args: {
  id: string;
  position: BehaviorPosition;
  intent: string;
  evaluatorDescription: string;
}): Behavior {
  return {
    id: args.id,
    position: args.position,
    intent: args.intent,
    evaluatorDescription: args.evaluatorDescription,
    signature: behaviorSignature(args.intent, args.evaluatorDescription),
  };
}

export type { BehaviorPosition, EvaluationOutcome };
