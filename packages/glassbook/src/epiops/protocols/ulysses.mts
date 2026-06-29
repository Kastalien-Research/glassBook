import type { TurnRecord } from '../kernel/index.mjs';
import { consideration, frameEntities, plannedBehaviors, unresolvedEvaluation } from './common.mjs';
import type { CodebaseProtocol, UlyssesPacket } from './types.mjs';

export const ulyssesProtocol: CodebaseProtocol = {
  id: 'ulysses',
  worldKind: 'codebase-git',
  usesBranch: true,
  async frame(ctx) {
    return frameEntities('ulysses', ctx.prompt);
  },
  async plot(ctx) {
    return plannedBehaviors('ulysses', ctx.turn);
  },
  async execute(behavior) {
    return unresolvedEvaluation(behavior);
  },
  async consider(_record: TurnRecord, entities) {
    return consideration('ulysses', entities);
  },
  async emit(): Promise<UlyssesPacket> {
    return { protocol: 'ulysses', packet: 'fix', resolved: false, checkpoints: [] };
  },
};
