import { ariadneProtocol } from './ariadne.mjs';
import { hephaestusProtocol } from './hephaestus.mjs';
import { theseusProtocol } from './theseus.mjs';
import { ulyssesProtocol } from './ulysses.mjs';
import type { CodebaseProtocol, CodebaseProtocolId } from './types.mjs';

const protocols: readonly CodebaseProtocol[] = [
  ulyssesProtocol,
  theseusProtocol,
  hephaestusProtocol,
  ariadneProtocol,
];

export function listProtocols(): readonly CodebaseProtocol[] {
  return protocols;
}

export function getProtocol(id: CodebaseProtocolId): CodebaseProtocol | undefined {
  return protocols.find((protocolDefinition) => protocolDefinition.id === id);
}
