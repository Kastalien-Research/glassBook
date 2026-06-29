import { describe, it, expect } from 'vitest';
import { UsageMeter } from './cost.mjs';

describe('UsageMeter', () => {
  it('ignores undefined usage', () => {
    const m = new UsageMeter();
    m.record('planner', undefined);
    expect(m.totals().calls).toBe(0);
    expect(m.format()).toBe('No model calls were recorded.');
  });

  it('normalizes v5 input/output token names', () => {
    const m = new UsageMeter();
    m.record('worker', { inputTokens: 100, outputTokens: 40, totalTokens: 140 });
    const t = m.totals();
    expect(t.inputTokens).toBe(100);
    expect(t.outputTokens).toBe(40);
    expect(t.totalTokens).toBe(140);
  });

  it('normalizes v4 prompt/completion token names and derives total', () => {
    const m = new UsageMeter();
    m.record('worker', { promptTokens: 10, completionTokens: 5 });
    expect(m.totals().totalTokens).toBe(15);
  });

  it('accumulates totals and groups by role', () => {
    const m = new UsageMeter();
    m.record('planner', { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
    m.record('worker', { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    m.record('worker', { inputTokens: 20, outputTokens: 10, totalTokens: 30 });

    const totals = m.totals();
    expect(totals.calls).toBe(3);
    expect(totals.totalTokens).toBe(192);

    const byRole = m.byRole();
    expect(byRole.worker.calls).toBe(2);
    expect(byRole.worker.totalTokens).toBe(180);
    expect(byRole.planner.totalTokens).toBe(12);
  });
});
