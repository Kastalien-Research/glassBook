import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import { detectInstallCommand, truncate } from './tools.mjs';

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
