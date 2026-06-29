/**
 * Retry with exponential backoff for transient LLM/network failures.
 *
 * The model calls in `subagent.mts` are the only place glassBook touches the
 * network. A single 429/503/timeout should not fail an entire section, so we
 * wrap those calls here. Backoff is deterministic and `sleep` is injectable so
 * the behavior is unit-testable without real delays.
 */

export interface RetryOptions {
  /** Max additional attempts after the first (default 3 → up to 4 calls). */
  retries?: number;
  /** Base backoff in ms (default 500). */
  baseMs?: number;
  /** Backoff ceiling in ms (default 8000). */
  maxMs?: number;
  /** Exponential factor (default 2). */
  factor?: number;
  /** Decide whether a thrown error is worth retrying (default: transient check). */
  isRetryable?: (error: unknown) => boolean;
  /** Injectable sleep (default: real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Observability hook fired before each retry sleep. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_PATTERNS = [
  'rate limit',
  'overloaded',
  'timeout',
  'timed out',
  'econnreset',
  'etimedout',
  'enotfound',
  'eai_again',
  'fetch failed',
  'socket hang up',
  'network',
  'service unavailable',
  'too many requests',
];

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const rec = error as Record<string, unknown>;
  const candidates = [rec.statusCode, rec.status, rec.code];
  for (const c of candidates) {
    if (typeof c === 'number') return c;
  }
  return undefined;
}

/** Heuristic: is this error a transient failure worth retrying? */
export function isTransientError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined && TRANSIENT_STATUS.has(status)) return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const lower = message.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => lower.includes(p));
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function backoffDelay(
  attempt: number,
  baseMs: number,
  factor: number,
  maxMs: number,
): number {
  return Math.min(maxMs, baseMs * Math.pow(factor, attempt));
}

/**
 * Run `fn`, retrying on retryable errors with exponential backoff. Re-throws the
 * last error once attempts are exhausted or the error is not retryable.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 8000;
  const factor = opts.factor ?? 2;
  const isRetryable = opts.isRetryable ?? isTransientError;
  const sleep = opts.sleep ?? realSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryable(error)) break;
      const delayMs = backoffDelay(attempt, baseMs, factor, maxMs);
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
