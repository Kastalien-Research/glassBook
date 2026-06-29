import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';

export function loadEnv(explicit?: string): string | undefined {
  const candidates = explicit
    ? [Path.resolve(explicit)]
    : [Path.resolve(process.cwd(), '.env'), Path.join(os.homedir(), '.srcbook', '.env')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      loadEnvFile(candidate);
      return candidate;
    }
  }
  return undefined;
}

function loadEnvFile(path: string): void {
  const values = parseEnvContent(fs.readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseEnvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const assignment = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equals = assignment.indexOf('=');
    if (equals <= 0) continue;

    const key = assignment.slice(0, equals).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;

    values[key] = parseEnvValue(assignment.slice(equals + 1).trim());
  }

  return values;
}

function parseEnvValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

export function isQuiet(): boolean {
  const value = process.env.SRCBOOK_QUIET;
  return value === '1' || value?.toLowerCase() === 'true';
}
