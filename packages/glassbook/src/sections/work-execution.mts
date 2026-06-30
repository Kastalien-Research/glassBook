import { sh, detectInstallCommand } from '../tools.mjs';
import type { WorkPlan, Plan, ExecutionResult } from '../schemas.mjs';
import type { SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';
import { runCodebaseProtocol } from '../epiops/codebase-runner.mjs';

/**
 * Section 5 — Work Execution.
 *
 * Dispatches to the chosen EpiOps process. Each codebase-family protocol owns
 * its packet semantics while sharing the same section boundary and setup path.
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

  const res = await runCodebaseProtocol({ ctx, plan, workPlan });
  if (!res.ok) return res;
  await emitter.section(
    'Work execution — Result',
    [
      `**Protocol:** ${res.value.protocol ?? workPlan.process}`,
      `**Desired state achieved:** ${res.value.desiredStateAchieved ? 'yes' : 'no'}`,
      '',
      res.value.evidence,
    ].join('\n'),
  );
  logger.success(
    `execution complete (protocol=${workPlan.process}, achieved=${res.value.desiredStateAchieved})`,
  );
  return ok(res.value);
}
