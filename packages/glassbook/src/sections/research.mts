import { runToolSubagent, runPlanSubagent } from '../subagent.mjs';
import { makeReadOnlyTools } from '../tools.mjs';
import { ResearchFindingsSchema, type ResearchFindings, type Plan } from '../schemas.mjs';
import { consumeBudget, budgetRemaining, type SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';

/**
 * Section 3 — Research.
 *
 * "What must be known before work begins (accessible vs not)?" A tool-using
 * subagent investigates the codebase/web, then a planning subagent synthesizes
 * structured findings. Bounded by the research cell budget.
 */
export async function runResearch(
  ctx: SectionContext,
  plan: Plan,
): Promise<Result<ResearchFindings>> {
  const { state, emitter, logger } = ctx;
  logger.section('3 · Research');

  const budget = consumeBudget(state, 'research', 1);
  if (!budget.ok) return budget;

  const maxSteps = Math.max(8, budgetRemaining(state, 'research') * 6 + 8);

  // Research must not mutate the repo: it gets a read-only tool set.
  const tools = makeReadOnlyTools(ctx.repoDir);

  const gatherSystem = [
    'You are the research cell of a glassBook notebook-agent.',
    'Investigate the repository (and the web if needed) to answer: what information is necessary before work can begin, what is accessible now, and what is NOT knowable until work happens?',
    'Use the tools to read files, search code, and run READ-ONLY shell commands (e.g. listing tests, checking how to run them).',
    'You must NOT modify, create, or delete any files, and must NOT run commands that change the repository. This is investigation only.',
    'Finish with a clear written report of findings, including how to run the relevant tests/build.',
  ].join('\n');

  const gatherPrompt = [
    `Objective: ${state.prompt}`,
    `Goal: ${plan.goal}`,
    `Proposed gate commands to validate:\n${plan.finalGates.map((g) => `- ${g.command}`).join('\n')}`,
  ].join('\n\n');

  const gather = await runToolSubagent({
    system: gatherSystem,
    prompt: gatherPrompt,
    tools,
    maxSteps,
    role: 'worker',
    meter: ctx.meter,
  });
  if (!gather.ok) return gather;

  await emitter.section('Research — Investigation', gather.value.text);

  const synth = await runPlanSubagent({
    schema: ResearchFindingsSchema,
    schemaName: 'ResearchFindings',
    system:
      'Convert the research report into structured findings. knownBeforeWork = necessary AND accessible now; unknowableBeforeWork = necessary but only discoverable during work.',
    prompt: gather.value.text,
    role: 'planner',
    meter: ctx.meter,
  });
  if (!synth.ok) return synth;

  await emitter.section(
    'Research — Findings',
    [
      `**Summary:** ${synth.value.summary}`,
      `\n**Known before work:**\n${synth.value.knownBeforeWork
        .map((a) => `- ${a.question} → ${a.answer} _(${a.source})_`)
        .join('\n')}`,
      synth.value.unknowableBeforeWork.length
        ? `\n**Not knowable before work:**\n- ${synth.value.unknowableBeforeWork.join('\n- ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  logger.success(`research done in ${gather.value.steps} step(s)`);
  return ok(synth.value);
}
