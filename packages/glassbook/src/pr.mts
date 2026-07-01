import type { GlassbookState } from './types.mjs';
import type { CodebaseProtocolPacket } from './epiops/protocols/types.mjs';

function usageLine(state: GlassbookState): string | undefined {
  const totals = state.usage?.totals as { calls?: unknown; totalTokens?: unknown } | undefined;
  if (!totals) return undefined;
  const calls = typeof totals.calls === 'number' ? totals.calls : 0;
  const totalTokens = typeof totals.totalTokens === 'number' ? totals.totalTokens : 0;
  return `**Usage:** ${calls} call(s), ${totalTokens} tokens`;
}

function protocolPacketSection(packet: CodebaseProtocolPacket | undefined): string | undefined {
  if (!packet) return undefined;
  const lines = [`**Protocol packet:** ${packet.packet}`];
  switch (packet.protocol) {
    case 'ulysses':
      lines.push(`- Objective: ${packet.objective ?? '(not recorded)'}`);
      lines.push(`- Resolved: ${packet.resolved ? 'yes' : 'no'}`);
      lines.push(`- Gates: ${(packet.gates ?? []).join(', ') || '(none)'}`);
      break;
    case 'theseus':
      lines.push(`- Objective: ${packet.objective}`);
      lines.push(`- Equivalent: ${packet.equivalent ? 'yes' : 'no'}`);
      lines.push(`- Invariants: ${packet.invariants.join('; ')}`);
      lines.push(`- Evaluators: ${packet.evaluatorSuite.join('; ')}`);
      lines.push(`- Remaining risks: ${packet.remainingRisks.join('; ')}`);
      break;
    case 'hephaestus':
      lines.push(`- Target failure: ${packet.targetFailure}`);
      lines.push(`- Reproducer: ${packet.reproducer}`);
      lines.push(`- Failure oracle: ${packet.failureOracle}`);
      lines.push(`- Minimized: ${packet.minimized ? 'yes' : 'no'}`);
      lines.push(`- Next workflow: ${packet.recommendedNextWorkflow}`);
      break;
    case 'ariadne':
      lines.push(`- Target intervention: ${packet.targetIntervention}`);
      lines.push(`- Nodes: ${packet.nodes.join('; ')}`);
      lines.push(`- Edges: ${packet.edges.map(([from, to]) => `${from} -> ${to}`).join('; ')}`);
      lines.push(`- Unknowns: ${packet.unknowns.join('; ')}`);
      lines.push(`- Recommended checks: ${packet.recommendedChecks.join('; ')}`);
      break;
  }
  return lines.join('\n');
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
    state.execution?.protocol ? `\n**Protocol:** ${state.execution.protocol}` : '',
    protocolPacketSection(state.execution?.packet)
      ? `\n${protocolPacketSection(state.execution?.packet)}`
      : '',
    ev
      ? `\n**Evaluation:** ${ev.verdict} (reward hacking: ${ev.rewardHackingDetected})\n\n${ev.reasoning}`
      : '',
    `\n**Checkpoints:** ${state.checkpoints.length}`,
    state.kernelTurns ? `\n**Kernel turns:** ${state.kernelTurns.length}` : '',
    `\n**Typed cells:** ${state.glassbookCells.length}`,
    state.recursiveContextCalls.length
      ? `\n**Recursive context calls:** ${state.recursiveContextCalls.length}`
      : '',
    usageLine(state) ? `\n${usageLine(state)}` : '',
    '',
    '_This PR was produced by a glassBook notebook-agent. The full audit notebook is available as a .src.md (openable in Srcbook)._',
  ]
    .filter(Boolean)
    .join('\n');
}
