import { describe, it, expect } from 'vitest';
import { runGates, NO_GATES_MESSAGE, type ShRunner } from './gates.mjs';

/** Builds a fake shell runner from a map of command -> exit code. */
function fakeRunner(codes: Record<string, number>): ShRunner {
  return async (command: string) => ({
    code: command in codes ? codes[command] : 0,
    combined: `output of: ${command}`,
  });
}

describe('runGates', () => {
  it('treats an empty gate set as NOT passed', async () => {
    const outcome = await runGates([], fakeRunner({}));
    expect(outcome.passed).toBe(false);
    expect(outcome.runs).toEqual([]);
    expect(outcome.output).toBe(NO_GATES_MESSAGE);
  });

  it('passes only when every gate exits 0', async () => {
    const gates = [
      { id: 'tests', command: 'npm test' },
      { id: 'types', command: 'npm run typecheck' },
    ];
    const outcome = await runGates(gates, fakeRunner({ 'npm test': 0, 'npm run typecheck': 0 }));
    expect(outcome.passed).toBe(true);
    expect(outcome.runs).toHaveLength(2);
    expect(outcome.output).toContain('PASS, exit 0');
  });

  it('fails when any gate exits non-zero and records per-gate status', async () => {
    const gates = [
      { id: 'tests', command: 'npm test' },
      { id: 'types', command: 'npm run typecheck' },
    ];
    const outcome = await runGates(gates, fakeRunner({ 'npm test': 0, 'npm run typecheck': 1 }));
    expect(outcome.passed).toBe(false);
    expect(outcome.runs.find((r) => r.id === 'tests')?.passed).toBe(true);
    expect(outcome.runs.find((r) => r.id === 'types')?.passed).toBe(false);
    expect(outcome.output).toContain('# gate: types (FAIL, exit 1)');
  });
});
