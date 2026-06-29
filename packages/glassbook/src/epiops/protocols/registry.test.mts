import { describe, it, expect } from 'vitest';
import { EpiOpsProcessIdSchema } from '../../schemas.mjs';
import { getProtocol, listProtocols } from './registry.mjs';

describe('protocol registry', () => {
  it('registers the codebase protocol family', () => {
    expect(listProtocols().map((p) => p.id)).toEqual([
      'ulysses',
      'theseus',
      'hephaestus',
      'ariadne',
    ]);
  });

  it('exposes protocol definitions by id', () => {
    const protocol = getProtocol('theseus');

    expect(protocol?.id).toBe('theseus');
    expect(protocol?.worldKind).toBe('codebase-git');
    expect(protocol?.usesBranch).toBe(true);
  });

  it('emits typed packets for every codebase protocol', async () => {
    const packets = await Promise.all(listProtocols().map((protocol) => protocol.emit({})));

    expect(packets).toEqual([
      { protocol: 'ulysses', packet: 'fix', resolved: false, checkpoints: [] },
      { protocol: 'theseus', packet: 'transformation', invariants: [], equivalent: false },
      { protocol: 'hephaestus', packet: 'reproduction', reproducer: '', minimized: false },
      { protocol: 'ariadne', packet: 'topology', nodes: [], edges: [] },
    ]);
  });
});

describe('EpiOpsProcessIdSchema', () => {
  it('accepts every registered protocol id', () => {
    for (const protocol of listProtocols()) {
      expect(EpiOpsProcessIdSchema.parse(protocol.id)).toBe(protocol.id);
    }
  });
});
