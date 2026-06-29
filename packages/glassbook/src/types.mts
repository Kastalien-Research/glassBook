import type {
  Plan,
  ResearchFindings,
  WorkPlan,
  ExecutionResult,
  EvaluationVerdict,
} from './schemas.mjs';

/**
 * Failure model (Effect-spirit, vanilla TS).
 *
 * We model expected failures as a tagged union rather than throwing. This is
 * the seed for the later Effect-TS refactor, where `GlassbookError` becomes the
 * error channel of an `Effect`.
 */
export type GlassbookErrorTag =
  | 'ConfigError'
  | 'PlanningError'
  | 'ResearchError'
  | 'WorkPlanError'
  | 'GateFailed'
  | 'BudgetExceeded'
  | 'ConsiderationExhausted'
  | 'ExecutionError'
  | 'EvaluationRejected'
  | 'GitError'
  | 'SubagentError';

export interface GlassbookError {
  readonly _tag: GlassbookErrorTag;
  readonly message: string;
  readonly cause?: unknown;
}

export function makeError(
  tag: GlassbookErrorTag,
  message: string,
  cause?: unknown,
): GlassbookError {
  return { _tag: tag, message, cause };
}

/**
 * Result<A>: success or a typed failure. No exceptions cross section boundaries.
 */
export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: GlassbookError };

export function ok<A>(value: A): Result<A> {
  return { ok: true, value };
}

export function err<A = never>(error: GlassbookError): Result<A> {
  return { ok: false, error };
}

export function isOk<A>(r: Result<A>): r is { ok: true; value: A } {
  return r.ok;
}

// ---------------------------------------------------------------------------
// Sections & budgets
// ---------------------------------------------------------------------------

export type SectionId =
  | 'loadPackages'
  | 'initialize'
  | 'research'
  | 'workPlan'
  | 'workExecution'
  | 'evaluation';

export const SECTION_ORDER: readonly SectionId[] = [
  'loadPackages',
  'initialize',
  'research',
  'workPlan',
  'workExecution',
  'evaluation',
] as const;

export interface SectionBudget {
  /** Max number of cells the section may create. */
  limit: number;
  /** How many it has used so far. */
  used: number;
}

export type Budgets = Record<SectionId, SectionBudget>;

// ---------------------------------------------------------------------------
// Run configuration & state
// ---------------------------------------------------------------------------

export interface RunConfig {
  readonly prompt: string;
  /** Absolute path to the target git repository. */
  readonly repoDir: string;
  /** Template id; v0 only supports 'codebase-update'. */
  readonly template: string;
  /** Per-section cell-creation budgets. */
  readonly budgets: Budgets;
  /** Base branch for the final PR. */
  readonly baseBranch: string;
  /** When true, do not push or open a PR (local-only dry run). */
  readonly skipPullRequest: boolean;
  /**
   * Explicit gate commands that pin how success is verified, overriding the
   * gates the Initialize planner would otherwise guess. Each is a shell command
   * whose exit code 0 means the criterion is satisfied.
   */
  readonly gateCommands?: string[];
  /** Allow the agent to install dependencies in the target repo. */
  readonly allowInstall: boolean;
  /** Where to also write the exported .src.md, if set. */
  readonly outFile?: string;
}

/**
 * The authoritative state object. Subagents return proposed patches; the
 * orchestrator is the only writer (LangGraph-style reduction).
 */
export interface GlassbookState {
  readonly prompt: string;
  readonly repoDir: string;
  readonly template: string;
  notebookDir?: string;
  plan?: Plan;
  research?: ResearchFindings;
  workPlan?: WorkPlan;
  execution?: ExecutionResult;
  evaluation?: EvaluationVerdict;
  budgets: Budgets;
  /** Commit hashes that mark successful turns (Ulysses checkpoints). */
  checkpoints: string[];
  /** The working branch the protocol operates on. */
  workingBranch?: string;
  /** PR url, when opened. */
  pullRequestUrl?: string;
  /** Token usage summary for the run (set at finalize). */
  usage?: { totals: unknown; byRole: unknown };
  failures: GlassbookError[];
}

export function initialState(config: RunConfig): GlassbookState {
  return {
    prompt: config.prompt,
    repoDir: config.repoDir,
    template: config.template,
    budgets: config.budgets,
    checkpoints: [],
    failures: [],
  };
}
