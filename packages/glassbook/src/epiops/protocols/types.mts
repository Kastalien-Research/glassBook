import type { ProtocolDefinition } from '../kernel/index.mjs';

export type CodebaseProtocolId = 'ulysses' | 'theseus' | 'hephaestus' | 'ariadne';

export interface UlyssesPacket {
  readonly protocol: 'ulysses';
  readonly packet: 'fix';
  readonly resolved: boolean;
  readonly checkpoints: string[];
}

export interface TheseusPacket {
  readonly protocol: 'theseus';
  readonly packet: 'transformation';
  readonly invariants: string[];
  readonly equivalent: boolean;
}

export interface HephaestusPacket {
  readonly protocol: 'hephaestus';
  readonly packet: 'reproduction';
  readonly reproducer: string;
  readonly minimized: boolean;
}

export interface AriadnePacket {
  readonly protocol: 'ariadne';
  readonly packet: 'topology';
  readonly nodes: string[];
  readonly edges: Array<readonly [string, string]>;
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
