import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import { replayRun } from './replay.mjs';

describe('replayRun', () => {
  let dir: string;
  let repoDir: string;
  let sidecarPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-replay-'));
    repoDir = Path.join(dir, 'repo');
    fs.mkdirSync(repoDir);
    sidecarPath = Path.join(dir, 'glassbook.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reruns final gates from a glassbook sidecar', async () => {
    fs.writeFileSync(Path.join(repoDir, 'done.txt'), 'ok\n');
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({
        repoDir,
        plan: {
          finalGates: [
            { id: 'done-file', description: 'done.txt exists', command: 'test -f done.txt' },
          ],
        },
      }),
    );

    const result = await replayRun(sidecarPath);

    expect(result.passed).toBe(true);
    expect(result.output).toContain('# gate: done-file (PASS');
  });

  it('fails when the sidecar has no final gates', async () => {
    fs.writeFileSync(sidecarPath, JSON.stringify({ repoDir, plan: { finalGates: [] } }));

    const result = await replayRun(sidecarPath);

    expect(result.passed).toBe(false);
    expect(result.output).toContain('No gate conditions were defined');
  });
});
