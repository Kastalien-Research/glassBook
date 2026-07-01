import { generateText, Output, stepCountIs } from 'ai';
import type { ToolSet } from 'ai';
import type { z } from 'zod';
import { getModel } from '@srcbook/api/headless';
import { makeError, ok, err, type Result } from './types.mjs';
import { withRetry } from './retry.mjs';
import type { UsageMeter, TokenUsageLike } from './cost.mjs';

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The roles a subagent can play. Each can be pinned to a different model via
 * `SRCBOOK_AI_MODEL_<ROLE>` (e.g. a stronger model for the adversarial reviewer)
 * while still using the configured provider + key.
 */
export type SubagentRole = 'planner' | 'worker' | 'reviewer' | 'hypothesis';

const ROLE_ENV: Record<SubagentRole, string> = {
  planner: 'SRCBOOK_AI_MODEL_PLANNER',
  worker: 'SRCBOOK_AI_MODEL_WORKER',
  reviewer: 'SRCBOOK_AI_MODEL_REVIEWER',
  hypothesis: 'SRCBOOK_AI_MODEL_HYPOTHESIS',
};

/** Default step ceilings per role; callers may still override explicitly. */
export const MAX_STEPS: Record<SubagentRole, number> = {
  planner: 1,
  worker: 30,
  reviewer: 18,
  hypothesis: 12,
};

/** Resolve the per-role model override, if any (env-driven, trimmed). */
export function resolveModelId(role?: SubagentRole): string | undefined {
  if (!role) return undefined;
  const value = process.env[ROLE_ENV[role]];
  return value && value.trim() ? value.trim() : undefined;
}

export const DEFAULT_MODEL_CALL_TIMEOUT_MS = 180_000;

export function resolveModelTimeoutMs(): number {
  const raw = process.env.GLASSBOOK_MODEL_TIMEOUT_MS;
  if (!raw) return DEFAULT_MODEL_CALL_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MODEL_CALL_TIMEOUT_MS;
}

async function withModelTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = resolveModelTimeoutMs(),
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`model call timed out after ${timeoutMs}ms`));
      controller.abort();
    }, timeoutMs);
    timeout.unref?.();
  });

  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

interface CommonArgs {
  /** Subagent role; selects the per-role model and tags usage. */
  role?: SubagentRole;
  /** Optional usage meter to record token consumption into. */
  meter?: UsageMeter;
  /** Max transient-failure retries (default from withRetry). */
  retries?: number;
  /** Per-attempt model-call timeout in ms; default from env or 180s. */
  modelTimeoutMs?: number;
}

export interface PlanSubagentOutput<T> {
  readonly output: T;
  readonly usage?: TokenUsageLike;
}

/**
 * Planning subagent: produces a schema-validated structured object. Used by the
 * Initialize and Work Plan sections, and to synthesize structured outputs from
 * tool-subagent transcripts.
 */
export async function runPlanSubagent<T>(
  args: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    schemaName?: string;
  } & CommonArgs,
): Promise<Result<T>> {
  const result = await runPlanSubagentDetailed(args);
  if (!result.ok) return err(result.error);
  return ok(result.value.output);
}

export async function runPlanSubagentDetailed<T>(
  args: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    schemaName?: string;
  } & CommonArgs,
): Promise<Result<PlanSubagentOutput<T>>> {
  try {
    const model = await getModel({ model: resolveModelId(args.role) });
    const result = await withRetry(
      () =>
        withModelTimeout(
          (abortSignal) =>
            generateText({
              model,
              output: Output.object({ schema: args.schema, name: args.schemaName }),
              system: args.system,
              prompt: args.prompt,
              abortSignal,
            }),
          args.modelTimeoutMs,
        ),
      { retries: args.retries },
    );
    const usage = result.usage as TokenUsageLike;
    args.meter?.record(args.role ?? 'planner', usage);
    return ok({ output: result.output as T, usage });
  } catch (e) {
    return err(makeError('SubagentError', `planning subagent failed: ${msg(e)}`, e));
  }
}

export interface ToolRunResult {
  text: string;
  steps: number;
}

/**
 * Tool-using subagent: runs a multi-step agent loop with the repo tool set and
 * returns the final text. Used by Research, Work Execution, and Evaluation.
 */
export async function runToolSubagent(
  args: {
    system: string;
    prompt: string;
    tools: ToolSet;
    maxSteps: number;
  } & CommonArgs,
): Promise<Result<ToolRunResult>> {
  try {
    const model = await getModel({ model: resolveModelId(args.role) });
    const result = await withRetry(
      () =>
        withModelTimeout(
          (abortSignal) =>
            generateText({
              model,
              system: args.system,
              prompt: args.prompt,
              tools: args.tools,
              stopWhen: stepCountIs(args.maxSteps),
              abortSignal,
            }),
          args.modelTimeoutMs,
        ),
      { retries: args.retries },
    );
    args.meter?.record(args.role ?? 'worker', result.usage as TokenUsageLike);
    return ok({ text: result.text, steps: result.steps.length });
  } catch (e) {
    return err(makeError('SubagentError', `tool subagent failed: ${msg(e)}`, e));
  }
}
