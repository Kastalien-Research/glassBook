import { describe, it, expect, vi } from 'vitest';
import { withRetry, isTransientError, backoffDelay } from './retry.mjs';

const noSleep = async (): Promise<void> => {};

describe('isTransientError', () => {
  it('flags transient HTTP statuses', () => {
    expect(isTransientError({ statusCode: 429 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
  });

  it('flags transient message patterns', () => {
    expect(isTransientError(new Error('Request timed out'))).toBe(true);
    expect(isTransientError(new Error('overloaded_error: server busy'))).toBe(true);
    expect(isTransientError(new Error('fetch failed'))).toBe(true);
  });

  it('does not flag ordinary errors', () => {
    expect(isTransientError(new Error('invalid schema'))).toBe(false);
    expect(isTransientError({ status: 400 })).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    expect(backoffDelay(0, 500, 2, 8000)).toBe(500);
    expect(backoffDelay(1, 500, 2, 8000)).toBe(1000);
    expect(backoffDelay(2, 500, 2, 8000)).toBe(2000);
    expect(backoffDelay(10, 500, 2, 8000)).toBe(8000);
  });
});

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn(async () => 'ok');
    const out = await withRetry(fn, { sleep: noSleep });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures then succeeds', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('rate limit exceeded');
      return 'recovered';
    });
    const out = await withRetry(fn, { sleep: noSleep, retries: 5 });
    expect(out).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn(async () => {
      throw new Error('invalid schema');
    });
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow('invalid schema');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and throws the last error', async () => {
    const fn = vi.fn(async () => {
      throw new Error('503 service unavailable');
    });
    await expect(withRetry(fn, { sleep: noSleep, retries: 2 })).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });
});
