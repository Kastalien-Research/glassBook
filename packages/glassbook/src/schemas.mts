import { z } from 'zod';
import type { CodebaseProtocolPacket } from './epiops/protocols/types.mjs';

/**
 * Structured outputs produced by the planning/evaluation subagents.
 *
 * These schemas are the load-bearing contract between the orchestrator and the
 * LLM. They are intentionally plain Zod today; when the codebase migrates to
 * Effect-TS these become the natural boundary for `Schema` definitions.
 */

// ---------------------------------------------------------------------------
// Section 2 - Initialize
// ---------------------------------------------------------------------------

export const GateConditionSpecSchema = z.object({
  id: z.string().describe('Stable identifier for this gate, e.g. "tests-pass".'),
  description: z.string().describe('What this gate verifies in plain language.'),
  /**
   * A shell command, run in the target repo, whose exit code 0 means the gate
   * passes. This is the executable validation for the cell/section.
   */
  command: z.string().describe('Shell command run in the repo; exit code 0 == gate passes.'),
});
export type GateConditionSpec = z.infer<typeof GateConditionSpecSchema>;

export const PlanSchema = z.object({
  goal: z.string().describe('A crisp restatement of the objective.'),
  successCriteria: z
    .array(z.string())
    .describe('Observable conditions that mean the prompt is satisfied.'),
  /**
   * Executable gates validating the final output of the notebook.
   */
  finalGates: z.array(GateConditionSpecSchema),
  assumptions: z.array(z.string()).describe('Assumptions taken before work begins.'),
  risks: z.array(z.string()).describe('Known risks (empty array if none).'),
});
export type Plan = z.infer<typeof PlanSchema>;

// ---------------------------------------------------------------------------
// Section 3 - Research
// ---------------------------------------------------------------------------

export const ResearchAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
  source: z.string().describe('Where this was learned (file path, URL, command).'),
});
export type ResearchAnswer = z.infer<typeof ResearchAnswerSchema>;

export const ResearchFindingsSchema = z.object({
  /** Information that is necessary AND accessible before work begins. */
  knownBeforeWork: z.array(ResearchAnswerSchema),
  /** Information that is necessary but NOT accessible before work begins. */
  unknowableBeforeWork: z.array(z.string()),
  summary: z.string().describe('A synthesis of what is now known.'),
});
export type ResearchFindings = z.infer<typeof ResearchFindingsSchema>;

// ---------------------------------------------------------------------------
// Section 4 - Work Plan
// ---------------------------------------------------------------------------

export const EpiOpsProcessIdSchema = z.enum(['ulysses', 'theseus', 'hephaestus', 'ariadne']);
export type EpiOpsProcessId = z.infer<typeof EpiOpsProcessIdSchema>;

export const WorkPlanSchema = z.object({
  process: EpiOpsProcessIdSchema.describe('The chosen EpiOps process.'),
  rationale: z.string().describe('Why this process fits the problem.'),
  primaryHypothesis: z
    .string()
    .describe('Best first action/hypothesis to make progress (protocol step 1).'),
  primaryEvaluator: GateConditionSpecSchema.describe(
    'Gate command that evaluates whether the primary behavior succeeded.',
  ),
  backupHypothesis: z.string().describe('Fallback action if the primary fails (protocol step 2).'),
  backupEvaluator: GateConditionSpecSchema.describe(
    'Gate command that evaluates whether the backup behavior succeeded.',
  ),
});
export type WorkPlan = z.infer<typeof WorkPlanSchema>;

// ---------------------------------------------------------------------------
// Section 5 - Work Execution
// ---------------------------------------------------------------------------

export const ExecutionResultSchema = z.object({
  desiredStateAchieved: z
    .boolean()
    .describe('Whether the gate/verification confirms the desired state.'),
  evidence: z.string().describe('Narrative evidence supporting the boolean.'),
  testOutput: z.string().describe('Raw output of the verification command(s).'),
  protocol: EpiOpsProcessIdSchema.optional().describe('The protocol that produced this result.'),
  packet: z.unknown().optional().describe('Protocol-specific emit packet persisted for audit.'),
  verification: z
    .object({
      baselinePassed: z.boolean().optional(),
      finalPassed: z.boolean(),
      commands: z.array(z.string()),
    })
    .optional()
    .describe('Protocol verification summary.'),
});
export type ExecutionResult = Omit<z.infer<typeof ExecutionResultSchema>, 'packet'> & {
  readonly packet?: CodebaseProtocolPacket;
};

// ---------------------------------------------------------------------------
// Section 6 - Evaluation (adversarial reviewer)
// ---------------------------------------------------------------------------

export const EvaluationVerdictSchema = z.object({
  verdict: z.enum(['approve', 'reject']),
  rewardHackingDetected: z
    .boolean()
    .describe('True if the evidence looks gamed (e.g. tests weakened/skipped).'),
  reasoning: z.string(),
  issues: z.array(z.string()).describe('Specific problems found (empty array if none).'),
});
export type EvaluationVerdict = z.infer<typeof EvaluationVerdictSchema>;
