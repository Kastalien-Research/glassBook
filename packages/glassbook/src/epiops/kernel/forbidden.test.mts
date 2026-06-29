import { describe, it, expect } from 'vitest';
import { ForbiddenStore } from './forbidden.mjs';

describe('ForbiddenStore', () => {
  it('forbids positionally (checkpoint + position + signature)', () => {
    const store = new ForbiddenStore();
    store.forbid({ fromCheckpoint: 'cp0', position: 1, signature: 'abcd1234', reason: 'failed' });

    expect(store.isForbidden('cp0', 1, 'abcd1234')).toBe(true);
    // same signature, different position → not forbidden
    expect(store.isForbidden('cp0', 2, 'abcd1234')).toBe(false);
    // same signature/position, different checkpoint → not forbidden
    expect(store.isForbidden('cp1', 1, 'abcd1234')).toBe(false);
  });

  it('dedupes identical entries', () => {
    const store = new ForbiddenStore();
    store.forbid({ fromCheckpoint: 'cp0', position: 1, signature: 's', reason: 'a' });
    store.forbid({ fromCheckpoint: 'cp0', position: 1, signature: 's', reason: 'b' });
    expect(store.size).toBe(1);
  });

  it('lists entries for a checkpoint', () => {
    const store = new ForbiddenStore();
    store.forbid({ fromCheckpoint: 'cp0', position: 1, signature: 's1', reason: 'a' });
    store.forbid({ fromCheckpoint: 'cp0', position: 2, signature: 's2', reason: 'b' });
    store.forbid({ fromCheckpoint: 'cp1', position: 1, signature: 's3', reason: 'c' });
    expect(store.forCheckpoint('cp0')).toHaveLength(2);
    expect(store.forCheckpoint('cp1')).toHaveLength(1);
    expect(store.all()).toHaveLength(3);
  });
});
