import { runPlanSubagent } from '../subagent.mjs';
import { PlanSchema, type Plan } from '../schemas.mjs';
import type { SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';

/**
 * Section 2 — Initialize.
 *
 * Turns the prompt into a structured Plan, including executable gate conditions
 * (shell commands) that define what "done" means for the final notebook output.
 */
export async function runInitialize(ctx: SectionContext): Promise<Result<Plan>> {
  const { state, emitter, logger, repoDir } = ctx;
  logger.section('2 · Initialize');

  const system = [
    'You are the planning cell of a glassBook notebook-agent working on a code repository.',
    'Produce a concise, executable plan.',
    'CRITICAL: every finalGate.command MUST be a real shell command that can be run in the repo root and whose exit code 0 means the criterion is satisfied (e.g. "npm test", "npm run typecheck", "npx vitest run path/to/test").',
    'Gates are how the notebook verifies success, so prefer existing test/build/lint commands. Do not invent commands that will not exist.',
  ].join('\n');

  const prompt = [
    `User request:\n${state.prompt}`,
    `\nTarget repository: ${repoDir}`,
    '\nInspect-then-plan is not possible here (no tools in this cell); rely on conventional commands and the request. The Research section will verify and refine.',
  ].join('\n');

  const res = await runPlanSubagent({
    schema: PlanSchema,
    schemaName: 'Plan',
    system,
    prompt,
    role: 'planner',
    meter: ctx.meter,
  });
  if (!res.ok) return res;
  const plan = res.value;

  await emitter.section(
    'Initialize — Plan',
    [
      `**Goal:** ${plan.goal}`,
      `\n**Success criteria:**\n- ${plan.successCriteria.join('\n- ')}`,
      `\n**Gate conditions:**\n${plan.finalGates
        .map((g) => `- \`${g.command}\` — ${g.description}`)
        .join('\n')}`,
      plan.assumptions.length ? `\n**Assumptions:**\n- ${plan.assumptions.join('\n- ')}` : '',
      plan.risks.length ? `\n**Risks:**\n- ${plan.risks.join('\n- ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  logger.success(`plan with ${plan.finalGates.length} gate(s)`);
  return ok(plan);
}
