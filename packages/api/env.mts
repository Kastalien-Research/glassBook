import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';

export function loadEnv(explicit?: string): string | undefined {
  const candidates = explicit
    ? [Path.resolve(explicit)]
    : [Path.resolve(process.cwd(), '.env'), Path.join(os.homedir(), '.srcbook', '.env')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
  }
  return undefined;
}

export function isQuiet(): boolean {
  const value = process.env.SRCBOOK_QUIET;
  return value === '1' || value?.toLowerCase() === 'true';
}
