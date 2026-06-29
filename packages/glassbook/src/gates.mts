/**
 * Pure gate evaluation. A gate is a shell command whose exit code 0 means the
 * criterion is satisfied. This module owns the reduction logic (all gates must
 * pass) and the evidence formatting, but takes the shell runner as a parameter
 * so it can be unit-tested with a fake and reused by the EpiOps kernel
 * (per-behavior evaluators) in roadmap Phase 4.
 */

export interface GateSpecLike {
  readonly id: string;
  readonly command: string;
}

export interface GateRun {
  readonly id: string;
  readonly command: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly output: string;
}

export interface GateOutcome {
  readonly passed: boolean;
  readonly runs: GateRun[];
  readonly output: string;
}

/** Runs a shell command and reports its exit code + combined output. */
export type ShRunner = (command: string) => Promise<{ code: number | null; combined: string }>;

export const NO_GATES_MESSAGE =
  'No gate conditions were defined, so the desired state cannot be verified.';

function formatRun(run: GateRun): string {
  return `# gate: ${run.id} (${run.passed ? 'PASS' : 'FAIL'}, exit ${run.exitCode})\n$ ${run.command}\n${run.output.trim()}`;
}

/**
 * Run every gate and reduce to a single pass/fail. Empty gate sets are treated
 * as NOT passed: an unverifiable state must never be reported as success.
 */
export async function runGates(
  gates: readonly GateSpecLike[],
  run: ShRunner,
): Promise<GateOutcome> {
  if (gates.length === 0) {
    return { passed: false, runs: [], output: NO_GATES_MESSAGE };
  }
  const runs: GateRun[] = [];
  let allPass = true;
  for (const g of gates) {
    const res = await run(g.command);
    const passed = res.code === 0;
    allPass = allPass && passed;
    runs.push({ id: g.id, command: g.command, passed, exitCode: res.code, output: res.combined });
  }
  return { passed: allPass, runs, output: runs.map(formatRun).join('\n\n') };
}
