import { runUlysses } from '../epiops/ulysses.mjs';
import { sh, detectInstallCommand } from '../tools.mjs';
import type { WorkPlan, Plan, ExecutionResult } from '../schemas.mjs';
import type { SectionContext } from '../context.mjs';
import { makeError, ok, err, type Result } from '../types.mjs';

/**
 * Section 5 — Work Execution.
 *
 * Dispatches to the chosen EpiOps process (v0: Ulysses). The process creates
 * cells, produces diffs, runs the gates, and loops until the desired state is
 * reached or the turn budget is exhausted.
 */
export async function runWorkExecution(
  ctx: SectionContext,
  plan: Plan,
  workPlan: WorkPlan,
): Promise<Result<ExecutionResult>> {
  const { emitter, logger, config, repoDir } = ctx;
  logger.section('5 · Work execution');

  if (config.allowInstall) {
    const installCmd = detectInstallCommand(repoDir);
    if (installCmd) {
      logger.step(`installing dependencies: ${installCmd}`);
      const res = await sh(installCmd, { cwd: repoDir, timeoutMs: 600_000 });
      await emitter.evidence(
        'Setup — install dependencies',
        'text',
        `$ ${installCmd}\nexit ${res.code}\n${res.combined.slice(0, 4000)}`,
      );
    }
  }

  switch (workPlan.process) {
    case 'ulysses':
    case 'theseus':
    case 'hephaestus':
    case 'ariadne': {
      const res = await runUlysses(ctx, plan, workPlan);
      if (!res.ok) return res;
      await emitter.section(
        'Work execution — Result',
        `**Desired state achieved:** ${res.value.desiredStateAchieved ? 'yes' : 'no'}\n\n${res.value.evidence}`,
      );
      logger.success(`execution complete (achieved=${res.value.desiredStateAchieved})`);
      return ok(res.value);
    }
    default: {
      const _exhaustive: never = workPlan.process;
      return err(makeError('WorkPlanError', `unknown EpiOps process: ${String(_exhaustive)}`));
    }
  }
}
