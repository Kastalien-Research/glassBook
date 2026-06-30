import { NotebookEmitter } from './emitter.mjs';
import { makeTools } from './tools.mjs';
import { createLogger, type Logger } from './logger.mjs';
import {
  initialState,
  makeError,
  type GlassbookState,
  type GlassbookError,
  type RunConfig,
} from './types.mjs';
import type { SectionContext } from './context.mjs';
import { getTemplate, codebaseUpdateTemplate } from './templates/codebase-update.mjs';
import { runLoadPackages } from './sections/load-packages.mjs';
import { runInitialize } from './sections/initialize.mjs';
import { runResearch } from './sections/research.mjs';
import { runWorkPlan } from './sections/work-plan.mjs';
import { runWorkExecution } from './sections/work-execution.mjs';
import { runEvaluation } from './sections/evaluation.mjs';
import { pushBranch, createPullRequest, revListCount } from './git.mjs';
import { buildPrBody } from './pr.mjs';
import { UsageMeter } from './cost.mjs';
import { runResultSection } from './effect-runtime.mjs';

export interface RunResult {
  readonly ok: boolean;
  readonly notebookDir: string;
  readonly srcmdPath?: string;
  readonly pullRequestUrl?: string;
  readonly state: GlassbookState;
}

/**
 * Run the full 6-section glassBook pipeline. The orchestrator is the only writer
 * of GlassbookState; sections return typed Results that it reduces into state.
 */
export async function runGlassbook(
  config: RunConfig,
  logger: Logger = createLogger(),
): Promise<RunResult> {
  const state = initialState(config);
  const template = getTemplate(config.template) ?? codebaseUpdateTemplate;

  const emitter = await NotebookEmitter.create(template.title(config.prompt));
  state.notebookDir = emitter.dir;
  logger.info(`notebook: ${emitter.dir}`);

  const meter = new UsageMeter();
  const ctx: SectionContext = {
    config,
    state,
    emitter,
    tools: makeTools(config.repoDir, config.sessionEnv),
    logger,
    repoDir: config.repoDir,
    meter,
  };

  const finalize = async (): Promise<void> => {
    state.usage = meter.toJSON();
    await emitter.section('Usage', meter.format());
    await emitter.persistState(state);
    if (config.outFile) {
      await emitter.writeSrcMd(config.outFile);
      logger.info(`exported .src.md: ${config.outFile}`);
    }
  };

  const fail = async (error: GlassbookError): Promise<RunResult> => {
    state.failures.push(error);
    logger.error(`${error._tag}: ${error.message}`);
    await emitter.section('Outcome — Failed', `\`${error._tag}\`: ${error.message}`);
    await finalize();
    return { ok: false, notebookDir: emitter.dir, srcmdPath: config.outFile, state };
  };

  // 1. Load packages / game board setup
  const lp = await runResultSection('loadPackages', () => runLoadPackages(ctx));
  if (!lp.ok) return fail(lp.error);

  // 2. Initialize
  const planR = await runResultSection('initialize', () => runInitialize(ctx));
  if (!planR.ok) return fail(planR.error);
  const plan = planR.value;
  state.plan = plan;

  // Pin the gates if the caller specified them explicitly (--gate). This removes
  // the biggest source of v0 unreliability: the planner guessing the gate.
  if (config.gateCommands && config.gateCommands.length > 0) {
    state.plan = {
      ...plan,
      finalGates: config.gateCommands.map((command, i) => ({
        id: `gate-${i + 1}`,
        description: 'user-specified gate (--gate)',
        command,
      })),
    };
    await emitter.section(
      'Initialize — Gates pinned',
      `Verification gates were pinned via --gate:\n${state.plan.finalGates
        .map((g) => `- \`${g.command}\``)
        .join('\n')}`,
    );
  }
  const finalPlan = state.plan;

  // 3. Research
  const researchR = await runResultSection('research', () => runResearch(ctx, finalPlan));
  if (!researchR.ok) return fail(researchR.error);
  const research = researchR.value;
  state.research = research;

  // 4. Work plan
  const wpR = await runResultSection('workPlan', () => runWorkPlan(ctx, finalPlan, research));
  if (!wpR.ok) return fail(wpR.error);
  const workPlan = wpR.value;
  state.workPlan = workPlan;

  // 5. Work execution
  const execR = await runResultSection('workExecution', () =>
    runWorkExecution(ctx, finalPlan, workPlan),
  );
  if (!execR.ok) return fail(execR.error);
  const execution = execR.value;
  state.execution = execution;
  // Persist the protocol packet before the adversarial evaluator runs. The
  // finalizer writes the complete state again after evaluation/outcome.
  await emitter.persistState(state);

  // 6. Evaluation
  const evalR = await runResultSection('evaluation', () =>
    runEvaluation(ctx, finalPlan, execution),
  );
  if (!evalR.ok) return fail(evalR.error);
  state.evaluation = evalR.value;

  const approved =
    state.evaluation.verdict === 'approve' &&
    !state.evaluation.rewardHackingDetected &&
    state.execution.desiredStateAchieved;

  if (!approved) {
    return fail(
      makeError(
        'EvaluationRejected',
        `evaluation did not approve the run: ${state.evaluation.reasoning}`,
      ),
    );
  }

  if (config.skipPullRequest) {
    logger.warn('approved, but --skip-pr set; not opening a PR');
    await emitter.section('Outcome — Approved (no PR)', 'Approved. PR skipped (local dry run).');
    await finalize();
    return { ok: true, notebookDir: emitter.dir, srcmdPath: config.outFile, state };
  }

  const branch = state.workingBranch;
  if (!branch) return fail(makeError('GitError', 'no working branch was created'));

  // Guard: don't push/PR if the branch has no commits beyond the baseline.
  const baseline = state.checkpoints[0];
  if (baseline) {
    const ahead = await revListCount(config.repoDir, `${baseline}..HEAD`);
    if (ahead.ok && ahead.value === 0) {
      return fail(
        makeError(
          'GitError',
          'the working branch has no commits beyond baseline, so there is nothing to open a PR for (the verified change was not committed)',
        ),
      );
    }
  }

  const push = await pushBranch(config.repoDir, branch);
  if (!push.ok) return fail(push.error);

  const pr = await createPullRequest(config.repoDir, {
    title: template.title(config.prompt),
    body: buildPrBody(state),
    base: config.baseBranch,
    head: branch,
  });
  if (!pr.ok) return fail(pr.error);
  state.pullRequestUrl = pr.value;

  await emitter.section('Outcome — PR opened', pr.value);
  logger.success(`PR opened: ${pr.value}`);
  await finalize();

  return {
    ok: true,
    notebookDir: emitter.dir,
    srcmdPath: config.outFile,
    pullRequestUrl: pr.value,
    state,
  };
}
