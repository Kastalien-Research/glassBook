import { runPlanSubagent } from '../subagent.mjs';
import { WorkPlanSchema, type WorkPlan, type Plan, type ResearchFindings } from '../schemas.mjs';
import { consumeBudget, type SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';
import { listProtocols } from '../epiops/protocols/registry.mjs';
import {
  loadCodebaseProtocolSources,
  type ProtocolSourceDefinition,
} from '../epiops/protocols/source.mjs';

/**
 * Section 4 — Work Plan.
 *
 * Chooses an EpiOps process and frames the first hypotheses. The codebase
 * protocol family shares the kernel-backed execution adapter, while the chosen
 * process names the strategy and packet shape for the audit trail.
 */
export async function runWorkPlan(
  ctx: SectionContext,
  plan: Plan,
  research: ResearchFindings,
): Promise<Result<WorkPlan>> {
  const { state, emitter, logger } = ctx;
  logger.section('4 · Work plan');
  const budget = consumeBudget(state, 'workPlan', 1);
  if (!budget.ok) return budget;

  const sourcesById = new Map(loadCodebaseProtocolSources().map((source) => [source.id, source]));
  const protocolOptions = listProtocols()
    .map((protocol) => {
      const source = sourcesById.get(protocol.id);
      if (!source) {
        return `- ${protocol.id}: ${protocol.worldKind}, branch=${protocol.usesBranch}`;
      }
      return formatProtocolOption(source, protocol.worldKind, protocol.usesBranch);
    })
    .join('\n');

  const system = [
    'You are the work-planning cell of a glassBook notebook-agent.',
    'Choose one available EpiOps process to drive execution.',
    'Use ulysses for root-cause-and-fix loops, theseus for behavior-preserving refactors/migrations, hephaestus for reproduction/minimization work, and ariadne for topology/discovery work.',
    'Then frame a concrete primary hypothesis (best first action) and a backup hypothesis, grounded in the research.',
    'For each behavior, include a behavior-specific evaluator gate. The evaluator command may match a final gate command when that is the right per-behavior check, but it must be attached to the behavior rather than only to the final plan.',
    'When final gates are user-pinned, reuse those commands for behavior evaluators unless a narrower behavior-specific command is clearly safer and equivalent.',
  ].join('\n');

  const prompt = [
    `Objective: ${state.prompt}`,
    `Goal: ${plan.goal}`,
    `Success criteria:\n- ${plan.successCriteria.join('\n- ')}`,
    `Final gates:\n${plan.finalGates.map((gate) => `- ${gate.id}: ${gate.command}`).join('\n')}`,
    `Research summary: ${research.summary}`,
    `Available protocols:\n${protocolOptions}`,
  ].join('\n\n');

  const res = await runPlanSubagent({
    schema: WorkPlanSchema,
    schemaName: 'WorkPlan',
    system,
    prompt,
    role: 'planner',
    meter: ctx.meter,
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

function formatProtocolOption(
  source: ProtocolSourceDefinition,
  worldKind: string,
  usesBranch: boolean,
): string {
  return [
    `- ${source.id}: ${source.title} (${worldKind}, branch=${usesBranch})`,
    `  entities: ${source.entities.join(', ')}`,
    `  behavior: action=${source.behaviorSchema.action}; evaluator=${source.behaviorSchema.evaluator}`,
    `  transition: ${source.transitions.map((transition) => transition.condition).join(' | ')}`,
    `  packet: ${source.packetSchema.join('; ')}`,
  ].join('\n');
}
