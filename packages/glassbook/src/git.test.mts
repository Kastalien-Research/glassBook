import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import { createBranch, ensureGithubRemote, pushBranch, restoreCheckpoint } from './git.mjs';

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function makeRepo(): string {
  const repo = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-git-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(Path.join(repo, 'README.md'), 'initial\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  return repo;
}

function makeBareRemote(): string {
  const remote = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-remote-'));
  git(remote, ['init', '--bare']);
  return remote;
}

describe('git helpers', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('creates a suffixed branch when the requested branch already exists', async () => {
    git(repo, ['branch', 'glassbook/existing']);

    const created = await createBranch(repo, 'glassbook/existing');

    expect(created).toEqual({ ok: true, value: 'glassbook/existing-2' });
    expect(git(repo, ['branch', '--show-current'])).toBe('glassbook/existing-2');
  });

  it('returns a clear error for non-GitHub origin remotes', async () => {
    git(repo, ['remote', 'add', 'origin', 'https://gitlab.com/example/repo.git']);

    const result = await ensureGithubRemote(repo);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('origin remote is not GitHub');
  });

  it('restores a checkpoint without deleting pre-existing untracked files', async () => {
    fs.writeFileSync(Path.join(repo, '.gitignore'), 'scratch.txt\n');
    git(repo, ['add', '.gitignore']);
    git(repo, ['commit', '-m', 'ignore scratch']);
    const checkpoint = git(repo, ['rev-parse', 'HEAD']);
    fs.writeFileSync(Path.join(repo, 'scratch.txt'), 'keep me\n');
    fs.writeFileSync(Path.join(repo, 'created-after.txt'), 'remove me\n');

    const result = await restoreCheckpoint(repo, checkpoint, ['scratch.txt']);

    expect(result.ok).toBe(true);
    expect(fs.existsSync(Path.join(repo, 'scratch.txt'))).toBe(true);
    expect(fs.existsSync(Path.join(repo, 'created-after.txt'))).toBe(false);
  });

  it('rebases over a remote branch update before retrying push', async () => {
    const remote = makeBareRemote();
    const other = fs.mkdtempSync(Path.join(os.tmpdir(), 'glassbook-other-'));
    try {
      git(repo, ['remote', 'add', 'origin', remote]);
      git(repo, ['checkout', '-b', 'glassbook/push-conflict']);
      fs.writeFileSync(Path.join(repo, 'local-a.txt'), 'local a\n');
      git(repo, ['add', 'local-a.txt']);
      git(repo, ['commit', '-m', 'local a']);
      git(repo, ['push', '-u', 'origin', 'glassbook/push-conflict']);

      git(other, ['clone', remote, '.']);
      git(other, ['config', 'user.email', 'other@example.com']);
      git(other, ['config', 'user.name', 'Other User']);
      git(other, ['checkout', 'glassbook/push-conflict']);
      fs.writeFileSync(Path.join(other, 'remote-b.txt'), 'remote b\n');
      git(other, ['add', 'remote-b.txt']);
      git(other, ['commit', '-m', 'remote b']);
      git(other, ['push']);

      fs.writeFileSync(Path.join(repo, 'local-c.txt'), 'local c\n');
      git(repo, ['add', 'local-c.txt']);
      git(repo, ['commit', '-m', 'local c']);

      const result = await pushBranch(repo, 'glassbook/push-conflict');

      expect(result.ok).toBe(true);
      const remoteLog = git(repo, ['ls-remote', 'origin', 'glassbook/push-conflict']);
      expect(remoteLog).toContain('refs/heads/glassbook/push-conflict');
      expect(git(repo, ['log', '--oneline', 'origin/glassbook/push-conflict'])).toContain(
        'local c',
      );
      expect(git(repo, ['log', '--oneline', 'origin/glassbook/push-conflict'])).toContain(
        'remote b',
      );
    } finally {
      fs.rmSync(remote, { recursive: true, force: true });
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
