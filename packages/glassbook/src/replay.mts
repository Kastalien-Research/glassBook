import fs from 'node:fs/promises';
import { runGates, type GateOutcome, type GateSpecLike } from './gates.mjs';
import { sh } from './tools.mjs';

interface ReplaySidecar {
  readonly repoDir?: unknown;
  readonly plan?: {
    readonly finalGates?: readonly GateSpecLike[];
  };
}

function asReplaySidecar(value: unknown): ReplaySidecar {
  return typeof value === 'object' && value !== null ? (value as ReplaySidecar) : {};
}

export async function replayRun(sidecarPath: string): Promise<GateOutcome> {
  const raw = await fs.readFile(sidecarPath, 'utf8');
  const sidecar = asReplaySidecar(JSON.parse(raw));
  const repoDir = typeof sidecar.repoDir === 'string' ? sidecar.repoDir : process.cwd();
  const gates = sidecar.plan?.finalGates ?? [];

  return runGates(gates, async (command) => {
    const result = await sh(command, { cwd: repoDir, timeoutMs: 300_000 });
    return { code: result.code, combined: result.combined };
  });
}
