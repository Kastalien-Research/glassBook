import type { ProtocolDefinition } from '../kernel/index.mjs';

export type CodebaseProtocolId = 'ulysses' | 'theseus' | 'hephaestus' | 'ariadne';

export interface UlyssesPacket {
  readonly protocol: 'ulysses';
  readonly packet: 'fix';
  readonly resolved: boolean;
  readonly checkpoints: string[];
  readonly objective?: string;
  readonly gates?: readonly string[];
  readonly evidence?: string;
}

export interface TheseusPacket {
  readonly protocol: 'theseus';
  readonly packet: 'transformation';
  readonly objective: string;
  readonly invariants: string[];
  readonly acceptedChanges: string[];
  readonly evaluatorSuite: string[];
  readonly equivalent: boolean;
  readonly rollbackPlan: string;
  readonly remainingRisks: string[];
}

export interface HephaestusPacket {
  readonly protocol: 'hephaestus';
  readonly packet: 'reproduction';
  readonly targetFailure: string;
  readonly reproducer: string;
  readonly minimalArtifacts: string[];
  readonly expectedBehavior: string;
  readonly actualBehavior: string;
  readonly failureOracle: string;
  readonly environmentRequirements: string[];
  readonly reducedDimensions: string[];
  readonly irreducibleDimensions: string[];
  readonly hypotheses: string[];
  readonly recommendedNextWorkflow: string;
  readonly minimized: boolean;
}

export interface AriadnePacket {
  readonly protocol: 'ariadne';
  readonly packet: 'topology';
  readonly targetIntervention: string;
  readonly nodes: string[];
  readonly edges: Array<readonly [string, string]>;
  readonly contracts: string[];
  readonly unknowns: string[];
  readonly hiddenCouplings: string[];
  readonly safeInterventionSurfaces: string[];
  readonly riskyInterventionSurfaces: string[];
  readonly recommendedChecks: string[];
}

export type CodebaseProtocolPacket =
  | UlyssesPacket
  | TheseusPacket
  | HephaestusPacket
  | AriadnePacket;

export interface CodebaseProtocolEntities {
  readonly protocol: CodebaseProtocolId;
  readonly prompt: string;
}

export type CodebaseProtocol = ProtocolDefinition<
  CodebaseProtocolEntities,
  CodebaseProtocolPacket
> & {
  readonly id: CodebaseProtocolId;
};
