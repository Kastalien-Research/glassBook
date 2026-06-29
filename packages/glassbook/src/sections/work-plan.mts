import { runPlanSubagent } from '../subagent.mjs';
import { WorkPlanSchema, type WorkPlan, type Plan, type ResearchFindings } from '../schemas.mjs';
import type { SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';

/**
 * Section 4 — Work Plan.
 *
 * Chooses an EpiOps process and frames the first hypotheses. v0 only ships the
 * Ulysses protocol, so the choice is fixed, but the rationale + hypotheses are
 * still produced structurally so the notebook is auditable.
 */
export async function runWorkPlan(
  ctx: SectionContext,
  plan: Plan,
  research: ResearchFindings,
): Promise<Result<WorkPlan>> {
  const { state, emitter, logger } = ctx;
  logger.section('4 · Work plan');

  const system = [
    'You are the work-planning cell of a glassBook notebook-agent.',
    'Choose an EpiOps process to drive execution. The ONLY available process in this version is "ulysses" (a root-cause-and-fix loop for a static codebase), so set process to "ulysses".',
    'Then frame a concrete primary hypothesis (best first action) and a backup hypothesis, grounded in the research.',
  ].join('\n');

  const prompt = [
    `Objective: ${state.prompt}`,
    `Goal: ${plan.goal}`,
    `Success criteria:\n- ${plan.successCriteria.join('\n- ')}`,
    `Research summary: ${research.summary}`,
  ].join('\n\n');

  const res = await runPlanSubagent({
    schema: WorkPlanSchema,
    schemaName: 'WorkPlan',
    system,
    prompt,
  });
  if (!res.ok) return res;

  await emitter.section(
    'Work plan — Chosen process',
    [
      `**Process:** ${res.value.process}`,
      `**Rationale:** ${res.value.rationale}`,
      `\n- **Primary hypothesis (step 1):** ${res.value.primaryHypothesis}`,
      `- **Backup hypothesis (step 2):** ${res.value.backupHypothesis}`,
    ].join('\n'),
  );

  logger.success(`process = ${res.value.process}`);
  return ok(res.value);
}
