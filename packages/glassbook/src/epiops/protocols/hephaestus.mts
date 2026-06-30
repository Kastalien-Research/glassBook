import type { TurnRecord } from '../kernel/index.mjs';
import { consideration, frameEntities, plannedBehaviors, unresolvedEvaluation } from './common.mjs';
import type { CodebaseProtocol, HephaestusPacket } from './types.mjs';

export const hephaestusProtocol: CodebaseProtocol = {
  id: 'hephaestus',
  worldKind: 'codebase-git',
  usesBranch: true,
  async frame(ctx) {
    return frameEntities('hephaestus', ctx.prompt);
  },
  async plot(ctx) {
    return plannedBehaviors('hephaestus', ctx.turn);
  },
  async execute(behavior) {
    return unresolvedEvaluation(behavior);
  },
  async consider(_record: TurnRecord, entities) {
    return consideration('hephaestus', entities);
  },
  async emit(): Promise<HephaestusPacket> {
    return {
      protocol: 'hephaestus',
      packet: 'reproduction',
      targetFailure: 'Capture and minimize the target failure while preserving the oracle.',
      reproducer: 'failure oracle command',
      minimalArtifacts: ['target repository snapshot'],
      expectedBehavior: 'The intended behavior described by the plan success criteria.',
      actualBehavior: 'The failure still reproduces under the oracle.',
      failureOracle: 'executable failure oracle',
      environmentRequirements: ['repository checkout', 'declared package dependencies'],
      reducedDimensions: ['unnecessary context removed only when the oracle remains valid'],
      irreducibleDimensions: [
        'No live reduction evidence was provided to this static packet emitter.',
      ],
      hypotheses: ['The minimized case should route into a debugging workflow next.'],
      recommendedNextWorkflow: 'Run Ulysses against the minimized reproducer.',
      minimized: false,
    };
  },
};
