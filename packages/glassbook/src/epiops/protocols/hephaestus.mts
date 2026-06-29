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
    return { protocol: 'hephaestus', packet: 'reproduction', reproducer: '', minimized: false };
  },
};
