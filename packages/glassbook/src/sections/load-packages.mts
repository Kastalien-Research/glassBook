import {
  ensureGitRepo,
  ensureGithubRemote,
  currentBranch,
  headHash,
  createBranch,
  isClean,
} from '../git.mjs';
import type { SectionContext } from '../context.mjs';
import { makeError, ok, err, type Result } from '../types.mjs';

/**
 * Section 1 — Load packages / Game board setup.
 *
 * Establishes the run environment: validates the target is a static git repo
 * with a GitHub remote, then cuts the working branch the protocol operates on.
 */
export async function runLoadPackages(ctx: SectionContext): Promise<Result<void>> {
  const { state, emitter, logger, repoDir, config } = ctx;
  logger.section('1 · Load packages / Game board setup');

  const repoOk = await ensureGitRepo(repoDir);
  if (!repoOk.ok) return repoOk;

  if (!config.skipPullRequest) {
    const remote = await ensureGithubRemote(repoDir);
    if (!remote.ok) return remote;
  }

  const clean = await isClean(repoDir);
  if (!clean.ok) return clean;
  if (!clean.value) {
    return err(
      makeError(
        'GitError',
        'the target repo has uncommitted changes; commit or stash them first (Ulysses requires a static codebase).',
      ),
    );
  }

  const base = await currentBranch(repoDir);
  if (!base.ok) return base;
  const head = await headHash(repoDir);
  if (!head.ok) return head;

  const branch = `glassbook/${Date.now()}`;
  const created = await createBranch(repoDir, branch, head.value);
  if (!created.ok) return created;
  state.workingBranch = branch;

  await emitter.section(
    'Load packages — Game board setup',
    [
      `- **Prompt:** ${state.prompt}`,
      `- **Repo:** \`${repoDir}\``,
      `- **Base branch:** \`${base.value}\``,
      `- **Working branch:** \`${branch}\``,
      `- **Baseline commit:** \`${head.value.slice(0, 10)}\``,
      `- **Budgets:** ${Object.entries(state.budgets)
        .map(([k, v]) => `${k}=${v.limit}`)
        .join(', ')}`,
    ].join('\n'),
  );

  logger.success(`working branch ${branch} created from ${base.value}`);
  return ok(undefined);
}
