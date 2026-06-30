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

    expect(packets.map((packet) => packet.protocol)).toEqual([
      'ulysses',
      'theseus',
      'hephaestus',
      'ariadne',
    ]);

    const theseus = packets.find((packet) => packet.protocol === 'theseus');
    const hephaestus = packets.find((packet) => packet.protocol === 'hephaestus');
    const ariadne = packets.find((packet) => packet.protocol === 'ariadne');

    expect(theseus).toMatchObject({
      protocol: 'theseus',
      packet: 'transformation',
      equivalent: expect.any(Boolean),
    });
    expect(hephaestus).toMatchObject({
      protocol: 'hephaestus',
      packet: 'reproduction',
      minimized: expect.any(Boolean),
    });
    expect(ariadne).toMatchObject({ protocol: 'ariadne', packet: 'topology' });

    expect(theseus?.invariants.length).toBeGreaterThan(0);
    expect(theseus?.evaluatorSuite.length).toBeGreaterThan(0);
    expect(hephaestus?.reproducer).not.toBe('');
    expect(hephaestus?.failureOracle).not.toBe('');
    expect(ariadne?.nodes.length).toBeGreaterThan(0);
    expect(ariadne?.unknowns.length).toBeGreaterThan(0);
  });
});

describe('EpiOpsProcessIdSchema', () => {
  it('accepts every registered protocol id', () => {
    for (const protocol of listProtocols()) {
      expect(EpiOpsProcessIdSchema.parse(protocol.id)).toBe(protocol.id);
    }
  });
});
