import { runPlanSubagent, runToolSubagent, MAX_STEPS } from '../subagent.mjs';
import { makeReadOnlyTools } from '../tools.mjs';
import { PlanSchema, type Plan } from '../schemas.mjs';
import type { SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';

/**
 * Section 2 — Initialize.
 *
 * Turns the prompt into a structured Plan, including executable gate conditions
 * (shell commands) that define what "done" means for the final notebook output.
 *
 * Gate quality is the biggest v0 reliability risk, so Initialize first runs a
 * read-only investigation to DISCOVER the repo's real test/build/lint commands
 * (package.json scripts, Makefile, CI config, test runner) rather than guessing
 * from conventions. The structured Plan is then grounded in that evidence. If
 * discovery fails, we fall back to conventional commands; an explicit `--gate`
 * still overrides everything downstream in the orchestrator.
 */
export async function runInitialize(ctx: SectionContext): Promise<Result<Plan>> {
  const { state, emitter, logger, repoDir } = ctx;
  logger.section('2 · Initialize');

  // Step A: discover the real verification commands (read-only).
  const discoverSystem = [
    'You are the planning cell of a glassBook notebook-agent working on a code repository.',
    'Investigate the repository (READ-ONLY) to discover the REAL commands that verify success: test, typecheck, build, and lint.',
    'Inspect package.json scripts, lockfiles, Makefile/Justfile, CI config (.github/workflows), and the test runner actually in use.',
    'You must NOT modify, create, or delete any files. Investigation only.',
    'Report the exact runnable commands and cite where each is defined (file + line/script name).',
  ].join('\n');
  const discoverPrompt = [`User request:\n${state.prompt}`, `Target repository: ${repoDir}`].join(
    '\n\n',
  );
  const discovery = await runToolSubagent({
    system: discoverSystem,
    prompt: discoverPrompt,
    tools: makeReadOnlyTools(repoDir),
    maxSteps: MAX_STEPS.worker,
    role: 'worker',
    meter: ctx.meter,
  });
  const discoveryText = discovery.ok
    ? discovery.value.text
    : `(command discovery failed: ${discovery.error.message}; falling back to conventional commands)`;
  await emitter.section('Initialize — Command discovery', discoveryText);

  // Step B: synthesize the structured Plan, grounded in the discovered commands.
  const system = [
    'You are the planning cell of a glassBook notebook-agent.',
    'Produce a concise, executable plan.',
    'CRITICAL: every finalGate.command MUST be a real shell command that runs in the repo root and whose exit code 0 means the criterion is satisfied.',
    'Prefer the commands surfaced by the investigation below; they were verified to exist. Do not invent commands that will not exist.',
  ].join('\n');

  const prompt = [
    `User request:\n${state.prompt}`,
    `\nTarget repository: ${repoDir}`,
    `\nRepository command investigation:\n${discoveryText}`,
  ].join('\n');

  const res = await runPlanSubagent({
    schema: PlanSchema,
    schemaName: 'Plan',
    system,
    prompt,
    role: 'planner',
    meter: ctx.meter,
  });
  if (!res.ok) return res;
  const plan = res.value;

  await emitter.section(
    'Initialize — Plan',
    [
      `**Goal:** ${plan.goal}`,
      `\n**Success criteria:**\n- ${plan.successCriteria.join('\n- ')}`,
      `\n**Gate conditions:**\n${plan.finalGates
        .map((g) => `- \`${g.command}\` — ${g.description}`)
        .join('\n')}`,
      plan.assumptions.length ? `\n**Assumptions:**\n- ${plan.assumptions.join('\n- ')}` : '',
      plan.risks.length ? `\n**Risks:**\n- ${plan.risks.join('\n- ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  logger.success(`plan with ${plan.finalGates.length} gate(s)`);
  return ok(plan);
}
