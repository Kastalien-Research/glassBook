import type { TurnRecord } from '../kernel/index.mjs';
import { consideration, frameEntities, plannedBehaviors, unresolvedEvaluation } from './common.mjs';
import type { AriadnePacket, CodebaseProtocol } from './types.mjs';

export const ariadneProtocol: CodebaseProtocol = {
  id: 'ariadne',
  worldKind: 'codebase-git',
  usesBranch: true,
  async frame(ctx) {
    return frameEntities('ariadne', ctx.prompt);
  },
  async plot(ctx) {
    return plannedBehaviors('ariadne', ctx.turn);
  },
  async execute(behavior) {
    return unresolvedEvaluation(behavior);
  },
  async consider(_record: TurnRecord, entities) {
    return consideration('ariadne', entities);
  },
  async emit(): Promise<AriadnePacket> {
    return {
      protocol: 'ariadne',
      packet: 'topology',
      targetIntervention: 'Map the topology needed before a codebase intervention is safe.',
      nodes: ['target repository', 'requested intervention surface'],
      edges: [['requested intervention surface', 'target repository']],
      contracts: ['topology claims require cited evidence'],
      unknowns: ['No live discovery evidence was provided to this static packet emitter.'],
      hiddenCouplings: [],
      safeInterventionSurfaces: [],
      riskyInterventionSurfaces: ['surfaces with unresolved topology unknowns'],
      recommendedChecks: ['run a protocol-specific verification workflow before intervening'],
    };
  },
};
