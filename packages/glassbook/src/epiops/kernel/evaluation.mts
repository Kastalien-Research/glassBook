/**
 * Graded evaluation outcome for a behavior. Binary protocols (Ulysses, Theseus,
 * Hephaestus, Ariadne) use success/failure/invalid; graded protocols (Hermes,
 * Cassandra, Minos, Janus) map their richer classifications onto this set.
 */
export type EvaluationOutcome =
  | 'success' // desired outcome achieved → checkpoint + reset
  | 'partial' // good-enough to bank a turn → checkpoint + reset
  | 'inconclusive' // no decisive movement → escalate / consider
  | 'failure' // explicit negative outcome
  | 'invalid'; // the evaluator itself broke (oracle invalidated, etc.)

export interface EvaluationResult {
  readonly outcome: EvaluationOutcome;
  /** Audit-readable justification, rendered into the notebook. */
  readonly evidence: string;
  /** Optional protocol-specific structured payload. */
  readonly data?: unknown;
}

/** Whether an outcome banks the current turn (checkpoint + reset to 0). */
export function isResolving(outcome: EvaluationOutcome): boolean {
  return outcome === 'success' || outcome === 'partial';
}
