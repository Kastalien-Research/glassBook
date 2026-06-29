import { z } from 'zod';
import { runToolSubagent, runPlanSubagent } from '../subagent.mjs';
import { makeReadOnlyTools } from '../tools.mjs';
import { ResearchFindingsSchema, type ResearchFindings, type Plan } from '../schemas.mjs';
import { consumeBudget, budgetRemaining, type SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';

/**
 * Section 3 — Research.
 *
 * "What must be known before work begins (accessible vs not)?" Rather than a
 * single pass, research now FANS OUT: a planner proposes up to `budget` distinct,
 * independently-investigable questions, each is investigated in its own read-only
 * cell (consuming one unit of the research budget), and a planner then synthesizes
 * structured findings across all of them. Falls back to a single investigation if
 * question-planning yields nothing.
 */

const ResearchQuestionsSchema = z.object({
  questions: z
    .array(z.string())
    .describe('Distinct, independently-investigable questions to answer before work begins.'),
});

/** Step ceiling for each focused per-question investigation. */
const STEPS_PER_QUESTION = 14;

export async function runResearch(
  ctx: SectionContext,
  plan: Plan,
): Promise<Result<ResearchFindings>> {
  const { state, emitter, logger } = ctx;
  logger.section('3 · Research');

  const tools = makeReadOnlyTools(ctx.repoDir);
  const budget = Math.max(1, budgetRemaining(state, 'research'));

  // 1. Plan distinct research questions (bounded by the research budget).
  const planned = await runPlanSubagent({
    schema: ResearchQuestionsSchema,
    schemaName: 'ResearchQuestions',
    system: [
      'You are planning the research cell of a glassBook notebook-agent.',
      'Propose distinct, independently-investigable questions that MUST be answered before work can begin.',
      'Each question should be answerable on its own by reading the repo or the web. Prefer fewer, higher-value questions.',
    ].join('\n'),
    prompt: [
      `Objective: ${state.prompt}`,
      `Goal: ${plan.goal}`,
      `Proposed gate commands to validate:\n${plan.finalGates.map((g) => `- ${g.command}`).join('\n')}`,
      `Propose at most ${budget} question(s).`,
    ].join('\n\n'),
    role: 'planner',
    meter: ctx.meter,
  });

  const questions: string[] =
    planned.ok && planned.value.questions.length > 0
      ? planned.value.questions.slice(0, budget)
      : [`What must be known before work can begin to accomplish: ${state.prompt}?`];

  await emitter.section(
    'Research — Plan',
    `Investigating ${questions.length} question(s):\n${questions.map((q) => `- ${q}`).join('\n')}`,
  );

  // 2. Investigate each question in its own read-only cell, consuming budget.
  const investigations: string[] = [];
  for (const [i, question] of questions.entries()) {
    const consumed = consumeBudget(state, 'research', 1);
    if (!consumed.ok) {
      logger.warn(`research budget exhausted after ${i} question(s)`);
      break;
    }

    const inv = await runToolSubagent({
      system: [
        'You are a research cell of a glassBook notebook-agent investigating ONE question.',
        'Use the tools to read files, search code, and run READ-ONLY shell commands (e.g. listing tests, checking how to run them).',
        'You must NOT modify, create, or delete any files, and must NOT run commands that change the repository.',
        'Finish with a focused, evidence-backed answer that cites file paths / commands.',
      ].join('\n'),
      prompt: [
        `Question to answer: ${question}`,
        `\nObjective: ${state.prompt}`,
        `Goal: ${plan.goal}`,
      ].join('\n'),
      tools,
      maxSteps: STEPS_PER_QUESTION,
      role: 'worker',
      meter: ctx.meter,
    });

    const text = inv.ok ? inv.value.text : `(investigation failed: ${inv.error.message})`;
    investigations.push(`### Q${i + 1}: ${question}\n\n${text}`);
    await emitter.section(`Research — Investigation ${i + 1}`, `**${question}**\n\n${text}`);
  }

  // 3. Synthesize structured findings across all investigations.
  const synth = await runPlanSubagent({
    schema: ResearchFindingsSchema,
    schemaName: 'ResearchFindings',
    system:
      'Convert the research investigations into structured findings. knownBeforeWork = necessary AND accessible now; unknowableBeforeWork = necessary but only discoverable during work.',
    prompt: investigations.join('\n\n---\n\n'),
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

  logger.success(`research done across ${investigations.length} investigation(s)`);
  return ok(synth.value);
}
