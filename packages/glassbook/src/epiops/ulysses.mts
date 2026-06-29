import { z } from 'zod';
import { sh } from '../tools.mjs';
import { runToolSubagent, runPlanSubagent } from '../subagent.mjs';
import { commitAll, headHash, isClean } from '../git.mjs';
import { budgetRemaining, consumeBudget, type SectionContext } from '../context.mjs';
import type { Plan, WorkPlan, ExecutionResult, GateConditionSpec } from '../schemas.mjs';
import { makeError, ok, type Result } from '../types.mjs';

/**
 * Ulysses Protocol engine (see workflows/ulysses.md).
 *
 * Faithful to the conceptual core: a state-step loop [0,1,2,-1] where step 1 is
 * the primary hypothesis, step 2 the backup, and -1 (CONSIDERATION) records the
 * failed behavior pair as forbidden before resetting. Each successful turn is a
 * checkpoint commit.
 *
 * v0 simplification: checkpoints are commits on a single protocol branch
 * (created by the orchestrator) rather than a fresh branch per loop. The
 * workExecution budget is interpreted as the maximum number of turns (N).
 */

const HypothesisSchema = z.object({
  primary: z.string().describe('Best next action/hypothesis to make progress.'),
  backup: z.string().describe('Fallback action if the primary fails.'),
});

interface GateResult {
  passed: boolean;
  output: string;
}

async function runGates(ctx: SectionContext, gates: GateConditionSpec[]): Promise<GateResult> {
  if (gates.length === 0) {
    return {
      passed: false,
      output: 'No gate conditions were defined, so the desired state cannot be verified.',
    };
  }
  let allPass = true;
  const chunks: string[] = [];
  for (const g of gates) {
    const res = await sh(g.command, { cwd: ctx.repoDir, timeoutMs: 300_000 });
    const pass = res.code === 0;
    allPass = allPass && pass;
    chunks.push(
      `# gate: ${g.id} (${pass ? 'PASS' : 'FAIL'}, exit ${res.code})\n$ ${g.command}\n${res.combined.trim()}`,
    );
  }
  return { passed: allPass, output: chunks.join('\n\n') };
}

async function captureDiff(ctx: SectionContext): Promise<string> {
  const res = await sh(
    'git add -A && git --no-pager diff --cached --stat && echo "----" && git --no-pager diff --cached',
    { cwd: ctx.repoDir, timeoutMs: 60_000 },
  );
  return res.combined.trim() || '(no changes)';
}

async function attempt(
  ctx: SectionContext,
  args: { hypothesis: string; stepLabel: string; plan: Plan; forbidden: string[] },
): Promise<Result<string>> {
  const installNote = ctx.config.allowInstall
    ? 'If dependencies are missing, you may run the appropriate install command (e.g. npm/pnpm/yarn install).'
    : 'Do NOT install new dependencies or run package managers.';

  const system = [
    'You are a subagent executing ONE cell of a glassBook notebook running the Ulysses Protocol.',
    'You are working in a real git repository. Use the provided tools to investigate and make MINIMAL, targeted changes that test the given hypothesis.',
    'Always run the relevant tests/build with runShell to check your work before finishing.',
    'Do not weaken, skip, or delete tests to make them pass. Fix the underlying problem.',
    'Edit files in place. Do NOT create backup or scratch copies (no *.buggy, *.fixed, *.bak, *.orig).',
    installNote,
    'When done, briefly summarize exactly what you changed and what the test output showed.',
  ].join('\n');

  const forbiddenBlock =
    args.forbidden.length > 0
      ? `\n\nThese behaviors already failed and are FORBIDDEN; do not repeat them:\n- ${args.forbidden.join('\n- ')}`
      : '';

  const prompt = [
    `Objective: ${ctx.state.prompt}`,
    `Goal: ${args.plan.goal}`,
    ctx.state.research?.summary ? `Research summary: ${ctx.state.research.summary}` : '',
    `Success criteria:\n- ${args.plan.successCriteria.join('\n- ')}`,
    `\nCurrent ${args.stepLabel} hypothesis to execute:\n${args.hypothesis}`,
    forbiddenBlock,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await runToolSubagent({ system, prompt, tools: ctx.tools, maxSteps: 30 });
  if (!res.ok) return res;
  return ok(res.value.text);
}

async function checkpoint(ctx: SectionContext, message: string): Promise<Result<string>> {
  const commit = await commitAll(ctx.repoDir, message);
  if (!commit.ok) return commit;
  ctx.state.checkpoints.push(commit.value);
  return commit;
}

/**
 * Commit the working tree if it has changes. This is the safety net that
 * guarantees an approved fix is captured on the branch, regardless of which path
 * produced it (a Ulysses turn, an earlier-than-expected fix, or setup). Returns
 * whether a commit was made.
 */
async function commitIfDirty(ctx: SectionContext, message: string): Promise<boolean> {
  const clean = await isClean(ctx.repoDir);
  if (clean.ok && !clean.value) {
    const c = await checkpoint(ctx, message);
    return c.ok;
  }
  return false;
}

async function resetToLastCheckpoint(ctx: SectionContext): Promise<void> {
  const last = ctx.state.checkpoints[ctx.state.checkpoints.length - 1];
  if (last) {
    await sh(`git reset --hard "${last}" && git clean -fd`, { cwd: ctx.repoDir, timeoutMs: 60_000 });
  }
}

export async function runUlysses(
  ctx: SectionContext,
  plan: Plan,
  workPlan: WorkPlan,
): Promise<Result<ExecutionResult>> {
  const { state, emitter, logger } = ctx;
  const gates = plan.finalGates;

  const baseline = await headHash(ctx.repoDir);
  if (!baseline.ok) return baseline;
  state.checkpoints.push(baseline.value);
  await emitter.markdown(
    `### Ulysses: Game Board Setup\n\nBaseline checkpoint: \`${baseline.value.slice(0, 10)}\`\n\nState step starts at 0.`,
  );

  // Maybe it's already resolved (e.g. setup fixed it, or it was never broken).
  const initialGate = await runGates(ctx, gates);
  if (initialGate.passed) {
    await emitter.evidence('Initial gate check (already satisfied)', 'text', initialGate.output);
    // Capture any pending working-tree changes so the fix lands on the branch.
    const committed = await commitIfDirty(
      ctx,
      'glassbook(ulysses): commit working state that already satisfies the gates',
    );
    return ok({
      desiredStateAchieved: true,
      evidence: committed
        ? 'The gates passed before any Ulysses turn; committed the pending working state.'
        : 'The desired state was already satisfied at baseline with no changes needed.',
      testOutput: initialGate.output,
    });
  }

  const forbidden: string[] = [];
  let resolved = false;
  let lastFailure = initialGate.output;
  let turn = 0;

  while (budgetRemaining(state, 'workExecution') > 0 && !resolved) {
    const turnBudget = consumeBudget(state, 'workExecution', 1);
    if (!turnBudget.ok) break;
    turn += 1;
    logger.step(`Ulysses turn ${turn}`);

    // Step 1: plot behaviors.
    let primary: string;
    let backup: string;
    if (turn === 1) {
      primary = workPlan.primaryHypothesis;
      backup = workPlan.backupHypothesis;
    } else {
      const plotted = await runPlanSubagent({
        schema: HypothesisSchema,
        schemaName: 'Hypotheses',
        system:
          'You are planning the next turn of the Ulysses Protocol. Propose a primary and a backup hypothesis for the next action. Avoid forbidden behaviors. Be concrete.',
        prompt: [
          `Objective: ${state.prompt}`,
          `Goal: ${plan.goal}`,
          `Most recent failure output:\n${lastFailure}`,
          forbidden.length ? `Forbidden behaviors:\n- ${forbidden.join('\n- ')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
      if (!plotted.ok) return plotted;
      primary = plotted.value.primary;
      backup = plotted.value.backup;
    }

    await emitter.markdown(
      `## Ulysses turn ${turn}: Plot behaviors\n\n- **Step 1 (primary):** ${primary}\n- **Step 2 (backup):** ${backup}`,
    );

    // Execute step 1.
    const r1 = await attempt(ctx, { hypothesis: primary, stepLabel: 'step 1', plan, forbidden });
    if (!r1.ok) return r1;
    const diff1 = await captureDiff(ctx);
    await emitter.markdown(`### Turn ${turn} · Step 1 result\n\n${r1.value}`);
    await emitter.evidence(`Turn ${turn} · Step 1 diff`, 'diff', diff1);
    const gate1 = await runGates(ctx, gates);
    await emitter.evidence(`Turn ${turn} · Step 1 gate`, 'text', gate1.output);

    if (gate1.passed) {
      const c = await checkpoint(ctx, `glassbook(ulysses): turn ${turn} step 1 — ${primary}`);
      if (!c.ok) return c;
      resolved = true;
      break;
    }

    // Execute step 2 (backup).
    const r2 = await attempt(ctx, { hypothesis: backup, stepLabel: 'step 2', plan, forbidden });
    if (!r2.ok) return r2;
    const diff2 = await captureDiff(ctx);
    await emitter.markdown(`### Turn ${turn} · Step 2 result\n\n${r2.value}`);
    await emitter.evidence(`Turn ${turn} · Step 2 diff`, 'diff', diff2);
    const gate2 = await runGates(ctx, gates);
    await emitter.evidence(`Turn ${turn} · Step 2 gate`, 'text', gate2.output);

    if (gate2.passed) {
      const c = await checkpoint(ctx, `glassbook(ulysses): turn ${turn} step 2 — ${backup}`);
      if (!c.ok) return c;
      resolved = true;
      break;
    }

    // CONSIDERATION (state step -1).
    forbidden.push(`[step 1] ${primary}`, `[step 2] ${backup}`);
    lastFailure = gate2.output;
    const consideration = await runToolSubagent({
      system:
        'You are in Ulysses CONSIDERATION mode. The last two behaviors failed. Hypothesize WHY they failed and what category of approach should be tried next. Do not modify files; you may inspect them.',
      prompt: `Objective: ${state.prompt}\n\nFailed step 1: ${primary}\nFailed step 2: ${backup}\n\nLatest gate output:\n${gate2.output}`,
      tools: ctx.tools,
      maxSteps: 12,
    });
    const considerationText = consideration.ok
      ? consideration.value.text
      : `(consideration failed: ${consideration.error.message})`;
    await emitter.markdown(
      `### Turn ${turn} · CONSIDERATION (state step -1)\n\n${considerationText}\n\n_Forbidden behaviors updated; resetting to last checkpoint._`,
    );
    await resetToLastCheckpoint(ctx);
  }

  const finalGate = await runGates(ctx, gates);
  // Safety net: if the gates pass but something is still uncommitted, commit it
  // so the branch reflects the verified state.
  if (finalGate.passed) {
    await commitIfDirty(ctx, 'glassbook(ulysses): commit final verified state');
  }
  const execution: ExecutionResult = {
    desiredStateAchieved: finalGate.passed && (resolved || ctx.state.checkpoints.length > 1),
    evidence: resolved
      ? `Resolved after ${turn} Ulysses turn(s).`
      : `Did not reach the desired state within the turn budget (${state.budgets.workExecution.limit}).`,
    testOutput: finalGate.output,
  };

  if (!execution.desiredStateAchieved) {
    state.failures.push(
      makeError(
        'ConsiderationExhausted',
        `Ulysses exhausted its turn budget without achieving the desired state after ${turn} turn(s).`,
      ),
    );
  }

  return ok(execution);
}
