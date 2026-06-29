import { describe, it, expect } from 'vitest';
import { makeError, ok, err } from './types.mjs';
import { effectToResult, resultToEffect, runResultSection } from './effect-runtime.mjs';

describe('effect runtime bridge', () => {
  it('uses GlassbookError as the Effect error channel', async () => {
    const failure = makeError('GitError', 'no remote');
    const result = await effectToResult(resultToEffect(err(failure)));

    expect(result).toEqual({ ok: false, error: failure });
  });

  it('converts successful Results into successful Effects', async () => {
    const result = await effectToResult(resultToEffect(ok(42)));

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('runs a Result-returning section through an Effect boundary', async () => {
    let attempts = 0;
    const result = await runResultSection('loadPackages', async () => {
      attempts += 1;
      return ok('loaded');
    });

    expect(result).toEqual({ ok: true, value: 'loaded' });
    expect(attempts).toBe(1);
  });
});
