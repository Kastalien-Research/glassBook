import type { GlassbookState } from './types.mjs';

/**
 * Build the GitHub PR body from the final run state. Pure (no IO, no
 * `@srcbook/api`), so it is unit-testable and is the seed for the richer,
 * run-derived PR body planned in roadmap Phase 7.
 */
export function buildPrBody(state: GlassbookState): string {
  const plan = state.plan;
  const ev = state.evaluation;
  return [
    '## glassBook run',
    '',
    `**Objective:** ${state.prompt}`,
    plan ? `\n**Goal:** ${plan.goal}` : '',
    plan ? `\n**Success criteria:**\n- ${plan.successCriteria.join('\n- ')}` : '',
    state.execution
      ? `\n**Verification:** desired state achieved = ${state.execution.desiredStateAchieved}`
      : '',
    ev
      ? `\n**Evaluation:** ${ev.verdict} (reward hacking: ${ev.rewardHackingDetected})\n\n${ev.reasoning}`
      : '',
    `\n**Checkpoints:** ${state.checkpoints.length}`,
    '',
    '_This PR was produced by a glassBook notebook-agent. The full audit notebook is available as a .src.md (openable in Srcbook)._',
  ]
    .filter(Boolean)
    .join('\n');
}
