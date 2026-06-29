import type { NotebookEmitter } from './emitter.mjs';
import type { GlassbookToolSet } from './tools.mjs';
import type { Logger } from './logger.mjs';
import type { UsageMeter } from './cost.mjs';
import {
  makeError,
  ok,
  err,
  type GlassbookState,
  type RunConfig,
  type SectionId,
  type Result,
} from './types.mjs';

/**
 * Everything a section needs from the orchestrator. Sections never construct
 * their own model/notebook/tools; they receive them here.
 */
export interface SectionContext {
  readonly config: RunConfig;
  readonly state: GlassbookState;
  readonly emitter: NotebookEmitter;
  readonly tools: GlassbookToolSet;
  readonly logger: Logger;
  readonly repoDir: string;
  /** Accumulates token usage across every subagent call in the run. */
  readonly meter: UsageMeter;
}

/** Remaining cell budget for a section. */
export function budgetRemaining(state: GlassbookState, id: SectionId): number {
  const b = state.budgets[id];
  return b.limit - b.used;
}

/**
 * Consume `n` cells from a section's budget. Fails with BudgetExceeded if the
 * section has no room left. This is what makes "create more cells until the
 * limit" a typed, enforceable contract.
 */
export function consumeBudget(state: GlassbookState, id: SectionId, n: number = 1): Result<void> {
  const b = state.budgets[id];
  if (b.used + n > b.limit) {
    return err(
      makeError(
        'BudgetExceeded',
        `section "${id}" exceeded its cell budget (limit ${b.limit}, attempted ${b.used + n})`,
      ),
    );
  }
  b.used += n;
  return ok(undefined);
}
