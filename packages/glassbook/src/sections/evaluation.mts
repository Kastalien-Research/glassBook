import { runToolSubagent, runPlanSubagent, MAX_STEPS } from '../subagent.mjs';
import {
  EvaluationVerdictSchema,
  type EvaluationVerdict,
  type Plan,
  type ExecutionResult,
} from '../schemas.mjs';
import { consumeBudget, type SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';

/**
 * Section 6 — Final notebook evaluation.
 *
 * An adversarial reviewer inspects the actual diff and test evidence for reward
 * hacking (weakened/skipped tests, hard-coded outputs, etc.) before producing a
 * structured verdict. The orchestrator uses the verdict to decide PR vs failure.
 */
export async function runEvaluation(
  ctx: SectionContext,
  plan: Plan,
  execution: ExecutionResult,
): Promise<Result<EvaluationVerdict>> {
  const { state, emitter, logger, tools } = ctx;
  logger.section('6 · Evaluation');

  const budget = consumeBudget(state, 'evaluation', 1);
  if (!budget.ok) return budget;

  const reviewSystem = [
    'You are an ADVERSARIAL reviewer cell of a glassBook notebook-agent.',
    'Your job is to detect reward hacking and gamification of the success evidence.',
    'Use the tools to inspect the actual changes (e.g. `git --no-pager diff <base>...HEAD`), the test files, and re-run the gates yourself.',
    'Look for: tests that were weakened/deleted/skipped, assertions removed, hard-coded return values, mocks that bypass the real bug, or success claimed without the gates actually passing.',
    'Write a candid review of whether the work genuinely satisfies the objective.',
  ].join('\n');

  const reviewPrompt = [
    `Objective: ${state.prompt}`,
    `Goal: ${plan.goal}`,
    `Working branch: ${state.workingBranch ?? '(unknown)'}`,
    `Gate commands:\n${plan.finalGates.map((g) => `- ${g.command}`).join('\n')}`,
    `\nClaimed result: desiredStateAchieved=${execution.desiredStateAchieved}`,
    `\nReported test output:\n${execution.testOutput}`,
  ].join('\n');

  const review = await runToolSubagent({
    system: reviewSystem,
    prompt: reviewPrompt,
    tools,
    maxSteps: MAX_STEPS.reviewer,
    role: 'reviewer',
    meter: ctx.meter,
  });
  const reviewText = review.ok
    ? review.value.text
    : `(review tool run failed: ${review.error.message})`;

  await emitter.section('Evaluation — Adversarial review', reviewText);

  const verdictRes = await runPlanSubagent({
    schema: EvaluationVerdictSchema,
    schemaName: 'EvaluationVerdict',
    system:
      'Based on the adversarial review, produce the final verdict. Approve ONLY if the objective is genuinely satisfied and the gates truly pass without gaming. If anything looks gamed, set rewardHackingDetected=true and verdict="reject".',
    prompt: `Objective: ${state.prompt}\n\nAdversarial review:\n${reviewText}\n\nClaimed test output:\n${execution.testOutput}`,
    role: 'reviewer',
    meter: ctx.meter,
  });
  if (!verdictRes.ok) return verdictRes;

  await emitter.section(
    'Evaluation — Verdict',
    [
      `**Verdict:** ${verdictRes.value.verdict.toUpperCase()}`,
      `**Reward hacking detected:** ${verdictRes.value.rewardHackingDetected ? 'yes' : 'no'}`,
      `\n${verdictRes.value.reasoning}`,
      verdictRes.value.issues.length
        ? `\n**Issues:**\n- ${verdictRes.value.issues.join('\n- ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  logger.success(`verdict = ${verdictRes.value.verdict}`);
  return ok(verdictRes.value);
}
