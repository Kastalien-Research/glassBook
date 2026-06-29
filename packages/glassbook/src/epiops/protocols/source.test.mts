import { describe, it, expect } from 'vitest';
import { loadCodebaseProtocolSources } from './source.mjs';

describe('protocol source loader', () => {
  it('loads typed source definitions from the workflow markdown files', () => {
    const sources = loadCodebaseProtocolSources();

    expect(sources.map((source) => source.id)).toEqual([
      'ulysses',
      'theseus',
      'hephaestus',
      'ariadne',
    ]);

    const ulysses = sources.find((source) => source.id === 'ulysses');
    expect(ulysses?.path).toBe('workflows/ulysses.md');
    expect(ulysses?.entities).toEqual(expect.arrayContaining(['checkpoints', 'behaviors']));
    expect(ulysses?.behaviorSchema.evaluator).toContain('evaluate');
    expect(ulysses?.transitions.map((transition) => transition.to)).toContain('-1');

    const theseus = sources.find((source) => source.id === 'theseus');
    expect(theseus?.packetSchema).toEqual(
      expect.arrayContaining(['the transformation objective', 'the preserved invariants']),
    );
  });

  it('keeps non-codebase protocol markdown out of the executable registry source set', () => {
    const sources = loadCodebaseProtocolSources();

    expect(sources.map((source) => source.id)).not.toContain('cassandra');
    expect(sources.map((source) => source.id)).not.toContain('hermes');
    expect(sources.map((source) => source.id)).not.toContain('janus');
  });
});
