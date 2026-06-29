/**
 * The EpiOps state machine — identical across all eight protocols
 * (see ../../design/epiops-primitives.md). A gamespace advances through
 * stateStep [0, 1, 2, -1]: 0 begins a turn, 1 runs the primary behavior, 2 runs
 * the backup, and -1 is CONSIDERATION when both fail. After CONSIDERATION the
 * counter resets to 0 and a new turn begins from the last checkpoint.
 */

export type StateStep = 0 | 1 | 2 | -1;

export const STEP_INITIAL = 0 satisfies StateStep;
export const STEP_PRIMARY = 1 satisfies StateStep;
export const STEP_BACKUP = 2 satisfies StateStep;
export const CONSIDERATION = -1 satisfies StateStep;

/** Which of the two plotted behaviors a step runs. */
export type BehaviorPosition = 1 | 2;

/**
 * Compute the next state step.
 *
 * - 0 → 1 (begin the turn with the primary behavior)
 * - 1 → 0 if the primary resolved the turn, else 2 (escalate to backup)
 * - 2 → 0 if the backup resolved the turn, else -1 (CONSIDERATION)
 * - -1 → 0 (reset after recording forbidden behaviors)
 *
 * `resolved` is only consulted at steps 1 and 2.
 */
export function nextStep(current: StateStep, resolved: boolean): StateStep {
  switch (current) {
    case 0:
      return 1;
    case 1:
      return resolved ? 0 : 2;
    case 2:
      return resolved ? 0 : -1;
    case -1:
      return 0;
    default: {
      const _exhaustive: never = current;
      throw new Error(`unknown state step: ${String(_exhaustive)}`);
    }
  }
}
