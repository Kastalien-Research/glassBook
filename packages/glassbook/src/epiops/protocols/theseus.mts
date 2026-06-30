import type { TurnRecord } from '../kernel/index.mjs';
import { consideration, frameEntities, plannedBehaviors, unresolvedEvaluation } from './common.mjs';
import type { CodebaseProtocol, TheseusPacket } from './types.mjs';

export const theseusProtocol: CodebaseProtocol = {
  id: 'theseus',
  worldKind: 'codebase-git',
  usesBranch: true,
  async frame(ctx) {
    return frameEntities('theseus', ctx.prompt);
  },
  async plot(ctx) {
    return plannedBehaviors('theseus', ctx.turn);
  },
  async execute(behavior) {
    return unresolvedEvaluation(behavior);
  },
  async consider(_record: TurnRecord, entities) {
    return consideration('theseus', entities);
  },
  async emit(): Promise<TheseusPacket> {
    return {
      protocol: 'theseus',
      packet: 'transformation',
      objective: 'Transform the codebase while preserving externally observable identity.',
      invariants: ['baseline gates continue to pass after each accepted transformation slice'],
      acceptedChanges: ['small transformation slices are accepted only after invariant gates pass'],
      evaluatorSuite: ['baseline gates', 'equivalence/final gates'],
      equivalent: false,
      rollbackPlan: 'Restore the last checkpoint or revert the protocol branch merge commit.',
      remainingRisks: ['No live Theseus run evidence was provided to this static packet emitter.'],
    };
  },
};
