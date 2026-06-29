import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import {
  detectInstallCommand,
  isAllowedWebFetchUrl,
  isShellSandboxAvailable,
  makeTools,
  sh,
  truncate,
} from './tools.mjs';

describe('truncate', () => {
  it('returns the input unchanged when within the limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('caps the length and appends a truncation marker', () => {
    const out = truncate('abcdefghij', 4);
    expect(out.startsWith('abcd')).toBe(true);
    expect(out).toContain('[truncated 6 chars]');
  });
});

describe('detectInstallCommand', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-tools-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when there is no package.json', () => {
    expect(detectInstallCommand(dir)).toBeNull();
  });

  it('prefers pnpm when a pnpm lockfile exists', () => {
    fs.writeFileSync(Path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(Path.join(dir, 'pnpm-lock.yaml'), '');
    expect(detectInstallCommand(dir)).toBe('pnpm install');
  });

  it('uses yarn for a yarn lockfile', () => {
    fs.writeFileSync(Path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(Path.join(dir, 'yarn.lock'), '');
    expect(detectInstallCommand(dir)).toBe('yarn install');
  });

  it('falls back to npm when only package.json exists', () => {
    fs.writeFileSync(Path.join(dir, 'package.json'), '{}');
    expect(detectInstallCommand(dir)).toBe('npm install');
  });
});

describe('sh', () => {
  const secretKey = 'GLASSBOOK_SECRET_TEST_VALUE';
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[secretKey];
    process.env[secretKey] = 'host-secret';
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[secretKey];
    } else {
      process.env[secretKey] = previous;
    }
  });

  it('does not inherit arbitrary host environment variables by default', async () => {
    const result = await sh(`printf "%s" "$${secretKey}"`, { cwd: process.cwd() });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('uses an explicit environment when supplied', async () => {
    const result = await sh(`printf "%s" "$${secretKey}"`, {
      cwd: process.cwd(),
      env: { [secretKey]: 'session-secret' },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('session-secret');
  });

  it('confines sandboxed commands to the repo filesystem', async () => {
    if (!isShellSandboxAvailable()) return;
    const repo = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-shell-sandbox-'));
    const outside = Path.join(os.tmpdir(), `glassbook-secret-${Date.now()}.txt`);
    fs.writeFileSync(outside, 'host-secret\n');
    try {
      const write = await sh('printf "ok" > inside.txt && cat inside.txt', {
        cwd: repo,
        sandbox: true,
      });
      expect(write.code).toBe(0);
      expect(write.stdout).toBe('ok');

      const readOutside = await sh(`cat "${outside}"`, { cwd: repo, sandbox: true });
      expect(readOutside.code).not.toBe(0);
      expect(readOutside.combined).not.toContain('host-secret');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }
  });

  it('fails closed when the shell sandbox is requested but unavailable', async () => {
    if (isShellSandboxAvailable()) return;
    const tools = makeTools(process.cwd());

    const result = await (tools.runShell as any).execute({ command: 'printf "unsafe"' });

    expect(result).toContain('exit_code: 126');
    expect(result).toContain('shell sandbox is not available on this host');
  });
});

describe('makeTools repo path constraints', () => {
  let repo: string;
  let outside: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-tools-repo-'));
    outside = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-tools-outside-'));
    fs.writeFileSync(Path.join(repo, 'inside.txt'), 'repo file\n');
    fs.writeFileSync(Path.join(outside, 'secret.txt'), 'outside file\n');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('allows absolute paths that resolve inside the repo', async () => {
    const tools = makeTools(repo);

    const result = await (tools.readFile as any).execute({
      path: Path.join(repo, 'inside.txt'),
    });

    expect(result).toBe('repo file\n');
  });

  it('rejects read and write paths outside the repo', async () => {
    const tools = makeTools(repo);
    const outsideFile = Path.join(outside, 'secret.txt');
    const escapedWrite = Path.join(outside, 'created.txt');

    const readResult = await (tools.readFile as any).execute({ path: outsideFile });
    const writeResult = await (tools.writeFile as any).execute({
      path: escapedWrite,
      content: 'leak\n',
    });

    expect(readResult).toContain('escapes repository');
    expect(writeResult).toContain('escapes repository');
    expect(fs.existsSync(escapedWrite)).toBe(false);
  });

  it('rejects list and search paths outside the repo', async () => {
    const tools = makeTools(repo);

    const listResult = await (tools.listFiles as any).execute({ dir: '../outside' });
    const searchResult = await (tools.searchCode as any).execute({
      pattern: 'outside',
      path: Path.join(outside, 'secret.txt'),
    });

    expect(listResult).toContain('escapes repository');
    expect(searchResult).toContain('escapes repository');
  });
});

describe('isAllowedWebFetchUrl', () => {
  it('allows public http and https URLs', () => {
    expect(isAllowedWebFetchUrl('https://example.com/docs')).toBe(true);
    expect(isAllowedWebFetchUrl('http://example.com/docs')).toBe(true);
  });

  it('blocks localhost and private-network URLs', () => {
    expect(isAllowedWebFetchUrl('http://localhost:3000')).toBe(false);
    expect(isAllowedWebFetchUrl('http://127.0.0.1:3000')).toBe(false);
    expect(isAllowedWebFetchUrl('http://[::1]:3000')).toBe(false);
    expect(isAllowedWebFetchUrl('http://10.0.0.1')).toBe(false);
    expect(isAllowedWebFetchUrl('http://192.168.1.10')).toBe(false);
    expect(isAllowedWebFetchUrl('http://172.16.0.1')).toBe(false);
  });
});
