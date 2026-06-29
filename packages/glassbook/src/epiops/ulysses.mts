import { z } from 'zod';
import { sh } from '../tools.mjs';
import { runGates as runGatesPure, type ShRunner } from '../gates.mjs';
import { runToolSubagent, runPlanSubagent, MAX_STEPS } from '../subagent.mjs';
import {
  checkout,
  commitAll,
  createBranch,
  currentBranch,
  headHash,
  isClean,
  mergeBranch,
  restoreCheckpoint,
} from '../git.mjs';
import { budgetRemaining, consumeBudget, type SectionContext } from '../context.mjs';
import type { Plan, WorkPlan, ExecutionResult, GateConditionSpec } from '../schemas.mjs';
import { makeError, ok, type Result } from '../types.mjs';
import { gateCodeSource } from '../notebook-code.mjs';
import { executeNotebookCodeCell } from '../notebook-runtime.mjs';
import { makeGlassbookCell } from '../cell.mjs';
import {
  makeBehavior,
  runGamespace,
  type Behavior,
  type ForbiddenStore,
  type TurnRecord,
} from './kernel/index.mjs';

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

function evaluatorDescription(gates: readonly GateConditionSpec[]): string {
  return gates.map((g) => `${g.id}: ${g.description} (${g.command})`).join('\n');
}

function forbiddenPrompt(forbidden: ForbiddenStore, checkpoint: string): string[] {
  return forbidden
    .forCheckpoint(checkpoint)
    .map((f) => `[step ${f.position}] signature ${f.signature}: ${f.reason}`);
}

function behaviorFor(turn: number, position: 1 | 2, intent: string, gate: GateConditionSpec) {
  return makeBehavior({
    id: `ulysses-t${turn}-step${position}`,
    position,
    intent,
    evaluatorDescription: evaluatorDescription([gate]),
    evaluatorGate: gate,
  });
}

async function runGates(ctx: SectionContext, gates: GateConditionSpec[]): Promise<GateResult> {
  const run: ShRunner = (command) =>
    sh(command, { cwd: ctx.repoDir, timeoutMs: 300_000 }).then((r) => ({
      code: r.code,
      combined: r.combined,
    }));
  const outcome = await runGatesPure(gates, run);
  return { passed: outcome.passed, output: outcome.output };
}

async function emitGateCells(
  ctx: SectionContext,
  gates: GateConditionSpec[],
  prefix: string,
): Promise<GateResult> {
  const output: string[] = [];
  let passed = true;
  const executeCodeCell =
    ctx.notebookRuntime?.executeCodeCell ??
    ((args: { readonly notebookDir: string; readonly filename: string }) =>
      executeNotebookCodeCell(args));

  for (const gate of gates) {
    const filename = `${prefix}-${gate.id}.ts`;
    await ctx.emitter.code(
      filename,
      gateCodeSource({ repoDir: ctx.repoDir, command: gate.command }),
    );
    const cell = await executeCodeCell({ notebookDir: ctx.emitter.dir, filename });
    output.push(`# cell: ${filename} (${cell.passed ? 'PASS' : 'FAIL'})\n${cell.output}`);
    if (!cell.passed) {
      passed = false;
    }
  }

  return { passed, output: output.join('\n\n') };
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

  const res = await runToolSubagent({
    system,
    prompt,
    tools: ctx.tools,
    maxSteps: MAX_STEPS.worker,
    role: 'worker',
    meter: ctx.meter,
  });
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

export async function runUlysses(
  ctx: SectionContext,
  plan: Plan,
  workPlan: WorkPlan,
): Promise<Result<ExecutionResult>> {
  const { state, emitter, logger } = ctx;
  const gates = plan.finalGates;

  const baseline = await headHash(ctx.repoDir);
  if (!baseline.ok) return baseline;
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

  let lastFailure = initialGate.output;
  let checkpointCalls = 0;
  let lastResolvingBehavior: Behavior | undefined;
  let activeTurnBranch: string | undefined;
  let activeTurn: number | undefined;

  async function workingBranch(): Promise<string> {
    if (state.workingBranch) return state.workingBranch;
    const branch = await currentBranch(ctx.repoDir);
    if (!branch.ok) throw new Error(branch.error.message);
    state.workingBranch = branch.value;
    return branch.value;
  }

  const kernel = await runGamespace({
    checkpoint: async () => {
      if (checkpointCalls === 0) {
        checkpointCalls += 1;
        state.checkpoints.push(baseline.value);
        return baseline.value;
      }

      checkpointCalls += 1;
      const behavior = lastResolvingBehavior;
      const message = behavior
        ? `glassbook(ulysses): turn step ${behavior.position} — ${behavior.intent}`
        : 'glassbook(ulysses): checkpoint';
      const c = await checkpoint(ctx, message);
      if (!c.ok) throw new Error(c.error.message);

      if (!activeTurnBranch || activeTurn === undefined) {
        return c.value;
      }

      const target = await workingBranch();
      const checkedOut = await checkout(ctx.repoDir, target);
      if (!checkedOut.ok) throw new Error(checkedOut.error.message);

      const merged = await mergeBranch(
        ctx.repoDir,
        activeTurnBranch,
        `glassbook(ulysses): merge Ulysses turn ${activeTurn}`,
      );
      if (!merged.ok) throw new Error(merged.error.message);

      const mergedHead = await headHash(ctx.repoDir);
      if (!mergedHead.ok) throw new Error(mergedHead.error.message);
      state.checkpoints[state.checkpoints.length - 1] = mergedHead.value;
      activeTurnBranch = undefined;
      activeTurn = undefined;
      return mergedHead.value;
    },

    restore: async (ref) => {
      const restored = await restoreCheckpoint(ctx.repoDir, ref);
      if (!restored.ok) throw new Error(restored.error.message);
    },

    plot: async ({ turn, fromCheckpoint, forbidden }) => {
      const turnBudget = consumeBudget(state, 'workExecution', 1);
      if (!turnBudget.ok) throw new Error(turnBudget.error.message);
      logger.step(`Ulysses turn ${turn}`);

      const target = await workingBranch();
      const created = await createBranch(ctx.repoDir, `${target}-turn-${turn}`, fromCheckpoint);
      if (!created.ok) throw new Error(created.error.message);
      activeTurnBranch = created.value;
      activeTurn = turn;

      let primary: string;
      let backup: string;
      const forbiddenEntries = forbiddenPrompt(forbidden, fromCheckpoint);
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
            forbiddenEntries.length
              ? `Forbidden behaviors:\n- ${forbiddenEntries.join('\n- ')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
          role: 'hypothesis',
          meter: ctx.meter,
        });
        if (!plotted.ok) throw new Error(plotted.error.message);
        primary = plotted.value.primary;
        backup = plotted.value.backup;
      }

      await emitter.markdown(
        [
          `## Ulysses turn ${turn}: Plot behaviors`,
          '',
          `- **Turn branch:** \`${created.value}\``,
          `- **Merge target:** \`${target}\``,
          `- **Step 1 (primary):** ${primary}`,
          `- **Step 2 (backup):** ${backup}`,
        ].join('\n'),
      );

      return {
        primary: behaviorFor(turn, 1, primary, workPlan.primaryEvaluator),
        backup: behaviorFor(turn, 2, backup, workPlan.backupEvaluator),
      };
    },

    execute: async (behavior) => {
      const stepLabel = `step ${behavior.position}`;
      const r = await attempt(ctx, {
        hypothesis: behavior.intent,
        stepLabel,
        plan,
        forbidden: [],
      });
      if (!r.ok) throw new Error(r.error.message);

      const diff = await captureDiff(ctx);
      await emitter.markdown(`### Turn behavior · Step ${behavior.position} result\n\n${r.value}`);
      await emitter.evidence(`Step ${behavior.position} diff`, 'diff', diff);
      const behaviorGates = behavior.evaluatorGate ? [behavior.evaluatorGate] : gates;
      const cellGate = await emitGateCells(ctx, behaviorGates, `ulysses-step-${behavior.position}`);
      await emitter.evidence(
        `Step ${behavior.position} executable gate cell`,
        'text',
        cellGate.output,
      );
      const gate = await runGates(ctx, behaviorGates);
      const combinedGate = {
        passed: cellGate.passed && gate.passed,
        output: [cellGate.output, gate.output].filter(Boolean).join('\n\n'),
      };
      await emitter.evidence(`Step ${behavior.position} gate`, 'text', gate.output);
      lastFailure = combinedGate.output;
      state.glassbookCells.push(
        makeGlassbookCell({
          section: 'workExecution',
          input: {
            prompt: state.prompt,
            goal: plan.goal,
            behavior: behavior.intent,
          },
          processing: {
            behaviorId: behavior.id,
            position: behavior.position,
            evaluator: behavior.evaluatorDescription,
          },
          output: {
            passed: combinedGate.passed,
            evidence: combinedGate.output,
          },
          gates: behaviorGates,
        }),
      );

      if (combinedGate.passed) {
        lastResolvingBehavior = behavior;
        return { outcome: 'success', evidence: combinedGate.output };
      }

      return { outcome: 'failure', evidence: combinedGate.output };
    },

    consider: async (record: TurnRecord) => {
      const primary = record.attempts.find((a) => a.position === 1)?.behavior.intent ?? '(none)';
      const backup = record.attempts.find((a) => a.position === 2)?.behavior.intent ?? '(none)';
      const consideration = await runToolSubagent({
        system:
          'You are in Ulysses CONSIDERATION mode. The last two behaviors failed. Hypothesize WHY they failed and what category of approach should be tried next. Do not modify files; you may inspect them.',
        prompt: `Objective: ${state.prompt}\n\nFailed step 1: ${primary}\nFailed step 2: ${backup}\n\nLatest gate output:\n${lastFailure}`,
        tools: ctx.tools,
        maxSteps: MAX_STEPS.hypothesis,
        role: 'hypothesis',
        meter: ctx.meter,
      });
      const considerationText = consideration.ok
        ? consideration.value.text
        : `(consideration failed: ${consideration.error.message})`;
      await emitter.markdown(
        `### Turn ${record.turn} · CONSIDERATION (state step -1)\n\n${considerationText}\n\n_Forbidden behaviors updated; resetting to last checkpoint._`,
      );
      return { hypothesis: considerationText };
    },

    budgetRemaining: () => budgetRemaining(state, 'workExecution'),
  });

  state.kernelTurns = kernel.turns;
  state.forbiddenBehaviors = kernel.forbidden.toJSON();

  const finalGate = await runGates(ctx, gates);
  // Safety net: if the gates pass but something is still uncommitted, commit it
  // so the branch reflects the verified state.
  if (finalGate.passed) {
    await commitIfDirty(ctx, 'glassbook(ulysses): commit final verified state');
  }
  const execution: ExecutionResult = {
    desiredStateAchieved: finalGate.passed && (kernel.resolved || ctx.state.checkpoints.length > 1),
    evidence: kernel.resolved
      ? `Resolved after ${kernel.turns.length} Ulysses turn(s).`
      : `Did not reach the desired state within the turn budget (${state.budgets.workExecution.limit}).`,
    testOutput: finalGate.output,
  };

  if (!execution.desiredStateAchieved) {
    state.failures.push(
      makeError(
        'ConsiderationExhausted',
        `Ulysses exhausted its turn budget without achieving the desired state after ${kernel.turns.length} turn(s).`,
      ),
    );
  }

  return ok(execution);
}
