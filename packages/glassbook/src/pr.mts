import type { GlassbookState } from './types.mjs';

function usageLine(state: GlassbookState): string | undefined {
  const totals = state.usage?.totals as { calls?: unknown; totalTokens?: unknown } | undefined;
  if (!totals) return undefined;
  const calls = typeof totals.calls === 'number' ? totals.calls : 0;
  const totalTokens = typeof totals.totalTokens === 'number' ? totals.totalTokens : 0;
  return `**Usage:** ${calls} call(s), ${totalTokens} tokens`;
}

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
    plan && plan.finalGates.length
      ? `\n**Final gates:**\n${plan.finalGates
          .map((gate) => `- \`${gate.command}\` — ${gate.description}`)
          .join('\n')}`
      : '',
    plan && plan.assumptions.length ? `\n**Assumptions:**\n- ${plan.assumptions.join('\n- ')}` : '',
    plan && plan.risks.length ? `\n**Risks:**\n- ${plan.risks.join('\n- ')}` : '',
    state.research ? `\n**Research summary:** ${state.research.summary}` : '',
    state.execution
      ? `\n**Verification:** desired state achieved = ${state.execution.desiredStateAchieved}\n\n${state.execution.evidence}`
      : '',
    ev
      ? `\n**Evaluation:** ${ev.verdict} (reward hacking: ${ev.rewardHackingDetected})\n\n${ev.reasoning}`
      : '',
    `\n**Checkpoints:** ${state.checkpoints.length}`,
    state.kernelTurns ? `\n**Kernel turns:** ${state.kernelTurns.length}` : '',
    `\n**Typed cells:** ${state.glassbookCells.length}`,
    usageLine(state) ? `\n${usageLine(state)}` : '',
    '',
    '_This PR was produced by a glassBook notebook-agent. The full audit notebook is available as a .src.md (openable in Srcbook)._',
  ]
    .filter(Boolean)
    .join('\n');
}
