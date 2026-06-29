import fs from 'node:fs/promises';
import os from 'node:os';
import Path from 'node:path';
import { sh } from './tools.mjs';
import { makeError, ok, err, type Result } from './types.mjs';

async function git(repoDir: string, cmd: string): Promise<Result<string>> {
  const res = await sh(`git ${cmd}`, { cwd: repoDir, timeoutMs: 120_000 });
  if (res.code !== 0) {
    const detail = res.stderr.trim() || res.stdout.trim();
    return err(makeError('GitError', `git ${cmd} failed (exit ${res.code}): ${detail}`));
  }
  return ok(res.stdout.trim());
}

export async function ensureGitRepo(repoDir: string): Promise<Result<void>> {
  const inside = await sh('git rev-parse --is-inside-work-tree', { cwd: repoDir });
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return err(makeError('GitError', `${repoDir} is not a git repository`));
  }
  return ok(undefined);
}

export async function ensureGithubRemote(repoDir: string): Promise<Result<string>> {
  const remote = await git(repoDir, 'remote get-url origin');
  if (!remote.ok) {
    return err(
      makeError('GitError', 'no "origin" remote configured (Ulysses requires a GitHub remote)'),
    );
  }
  if (!/github\.com/i.test(remote.value)) {
    return err(makeError('GitError', `origin remote is not GitHub: ${remote.value}`));
  }
  return ok(remote.value);
}

export function currentBranch(repoDir: string): Promise<Result<string>> {
  return git(repoDir, 'rev-parse --abbrev-ref HEAD');
}

export function headHash(repoDir: string): Promise<Result<string>> {
  return git(repoDir, 'rev-parse HEAD');
}

export async function isClean(repoDir: string): Promise<Result<boolean>> {
  const status = await git(repoDir, 'status --porcelain');
  if (!status.ok) return status;
  return ok(status.value.length === 0);
}

export async function createBranch(
  repoDir: string,
  name: string,
  fromRef?: string,
): Promise<Result<string>> {
  const r = await git(repoDir, `checkout -b "${name}"${fromRef ? ` "${fromRef}"` : ''}`);
  if (!r.ok) return r;
  return ok(name);
}

export function checkout(repoDir: string, ref: string): Promise<Result<string>> {
  return git(repoDir, `checkout "${ref}"`);
}

export async function commitAll(repoDir: string, message: string): Promise<Result<string>> {
  const add = await git(repoDir, 'add -A');
  if (!add.ok) return add;

  const tmp = Path.join(os.tmpdir(), `glassbook-commit-${Date.now()}.txt`);
  await fs.writeFile(tmp, message, 'utf8');
  const res = await sh(`git commit -F "${tmp}"`, { cwd: repoDir, timeoutMs: 60_000 });
  await fs.rm(tmp, { force: true });

  if (res.code !== 0) {
    return err(makeError('GitError', `commit failed: ${res.combined.trim()}`));
  }
  return headHash(repoDir);
}

export function pushBranch(repoDir: string, branch: string): Promise<Result<string>> {
  return git(repoDir, `push -u origin "${branch}"`);
}

/** Number of commits in `range` (e.g. "<baseline>..HEAD"). */
export async function revListCount(repoDir: string, range: string): Promise<Result<number>> {
  const r = await git(repoDir, `rev-list --count ${range}`);
  if (!r.ok) return r;
  return ok(parseInt(r.value.trim(), 10) || 0);
}

export async function createPullRequest(
  repoDir: string,
  args: { title: string; body: string; base: string; head: string },
): Promise<Result<string>> {
  const tmp = Path.join(os.tmpdir(), `glassbook-pr-${Date.now()}.md`);
  await fs.writeFile(tmp, args.body, 'utf8');
  const res = await sh(
    `gh pr create --base "${args.base}" --head "${args.head}" --title "${args.title.replace(/"/g, '\\"')}" --body-file "${tmp}"`,
    { cwd: repoDir, timeoutMs: 120_000 },
  );
  await fs.rm(tmp, { force: true });

  if (res.code !== 0) {
    return err(makeError('GitError', `gh pr create failed: ${res.combined.trim()}`));
  }
  const url =
    res.stdout
      .trim()
      .split('\n')
      .find((l) => l.startsWith('http')) ?? res.stdout.trim();
  return ok(url);
}
