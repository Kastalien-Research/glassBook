import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';

const ENV_KEY = 'SRCBOOK_ENV_TEST_VALUE';

describe('loadEnv', () => {
  let dir: string;
  let cwd: string;
  let previous: string | undefined;
  let previousLoadEnvFile: unknown;

  beforeEach(() => {
    dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'srcbook-env-'));
    cwd = process.cwd();
    previous = process.env[ENV_KEY];
    previousLoadEnvFile = (process as any).loadEnvFile;
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
    (process as any).loadEnvFile = previousLoadEnvFile;
  });

  it('loads cwd .env when no explicit path is provided', async () => {
    const envPath = Path.join(dir, '.env');
    fs.writeFileSync(envPath, `${ENV_KEY}=from-cwd\n`);
    process.chdir(dir);

    const { loadEnv } = await import('../env.mjs');

    expect(fs.realpathSync(loadEnv() ?? '')).toBe(fs.realpathSync(envPath));
    expect(process.env[ENV_KEY]).toBe('from-cwd');
  });

  it('loads a workspace ancestor .env when running from a package directory', async () => {
    const envPath = Path.join(dir, '.env');
    const packageDir = Path.join(dir, 'packages', 'api');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(envPath, `${ENV_KEY}=from-workspace-root\n`);
    process.chdir(packageDir);

    const { loadEnv } = await import('../env.mjs');

    expect(fs.realpathSync(loadEnv() ?? '')).toBe(fs.realpathSync(envPath));
    expect(process.env[ENV_KEY]).toBe('from-workspace-root');
  });

  it('prefers an explicit env file over cwd .env', async () => {
    const explicitPath = Path.join(dir, 'explicit.env');
    fs.writeFileSync(Path.join(dir, '.env'), `${ENV_KEY}=from-cwd\n`);
    fs.writeFileSync(explicitPath, `${ENV_KEY}=from-explicit\n`);
    process.chdir(dir);

    const { loadEnv } = await import('../env.mjs');

    expect(loadEnv(explicitPath)).toBe(explicitPath);
    expect(process.env[ENV_KEY]).toBe('from-explicit');
  });

  it('loads env files without process.loadEnvFile for Node 18 compatibility', async () => {
    const envPath = Path.join(dir, '.env');
    fs.writeFileSync(envPath, `${ENV_KEY}=node18\n`);
    process.chdir(dir);
    (process as any).loadEnvFile = undefined;

    const { loadEnv } = await import('../env.mjs');

    expect(fs.realpathSync(loadEnv() ?? '')).toBe(fs.realpathSync(envPath));
    expect(process.env[ENV_KEY]).toBe('node18');
  });
});

describe('isQuiet', () => {
  const key = 'SRCBOOK_QUIET';
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[key];
    delete process.env[key];
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  });

  it('recognizes truthy quiet values', async () => {
    const { isQuiet } = await import('../env.mjs');

    process.env[key] = '1';
    expect(isQuiet()).toBe(true);
    process.env[key] = 'true';
    expect(isQuiet()).toBe(true);
  });

  it('does not treat unset or ordinary values as quiet mode', async () => {
    const { isQuiet } = await import('../env.mjs');

    expect(isQuiet()).toBe(false);
    process.env[key] = '0';
    expect(isQuiet()).toBe(false);
  });
});
