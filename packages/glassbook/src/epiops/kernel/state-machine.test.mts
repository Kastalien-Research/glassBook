import { describe, it, expect } from 'vitest';
import { nextStep } from './state-machine.mjs';

describe('nextStep', () => {
  it('begins a turn from 0 by moving to the primary (1)', () => {
    expect(nextStep(0, false)).toBe(1);
    expect(nextStep(0, true)).toBe(1);
  });

  it('from primary: resolves to 0, otherwise escalates to backup (2)', () => {
    expect(nextStep(1, true)).toBe(0);
    expect(nextStep(1, false)).toBe(2);
  });

  it('from backup: resolves to 0, otherwise enters CONSIDERATION (-1)', () => {
    expect(nextStep(2, true)).toBe(0);
    expect(nextStep(2, false)).toBe(-1);
  });

  it('resets to 0 after CONSIDERATION', () => {
    expect(nextStep(-1, false)).toBe(0);
    expect(nextStep(-1, true)).toBe(0);
  });
});
