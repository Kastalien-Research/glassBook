import { makeBehavior, type Behavior, type EvaluationResult } from '../kernel/index.mjs';
import type { CodebaseProtocolEntities, CodebaseProtocolId } from './types.mjs';

export function frameEntities(protocol: CodebaseProtocolId, prompt: string) {
  return {
    objective: {
      statement: prompt,
      successCondition: 'The protocol-specific evaluator reports success.',
      stopCondition: 'The final gate conditions pass.',
    },
    entities: { protocol, prompt },
  };
}

export function plannedBehaviors(
  protocol: CodebaseProtocolId,
  turn: number,
): { primary: Behavior; backup: Behavior } {
  return {
    primary: makeBehavior({
      id: `${protocol}-t${turn}-primary`,
      position: 1,
      intent: `${protocol} primary behavior`,
      evaluatorDescription: `${protocol} primary evaluator`,
    }),
    backup: makeBehavior({
      id: `${protocol}-t${turn}-backup`,
      position: 2,
      intent: `${protocol} backup behavior`,
      evaluatorDescription: `${protocol} backup evaluator`,
    }),
  };
}

export function unresolvedEvaluation(behavior: Behavior): EvaluationResult {
  return {
    outcome: 'inconclusive',
    evidence: `${behavior.id} is defined but requires the live codebase adapter to execute.`,
  };
}

export function consideration(protocol: CodebaseProtocolId, entities: CodebaseProtocolEntities) {
  return { hypothesis: `${protocol} should replot for: ${entities.prompt}` };
}
