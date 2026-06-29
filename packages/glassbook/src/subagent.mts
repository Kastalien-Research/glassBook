import { generateText, generateObject, stepCountIs } from 'ai';
import type { ToolSet } from 'ai';
import type { z } from 'zod';
import { getModel } from '@srcbook/api/headless';
import { makeError, ok, err, type Result } from './types.mjs';

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Planning subagent: produces a schema-validated structured object. Used by the
 * Initialize and Work Plan sections, and to synthesize structured outputs from
 * tool-subagent transcripts.
 */
export async function runPlanSubagent<T>(args: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName?: string;
}): Promise<Result<T>> {
  try {
    const model = await getModel();
    const result = await generateObject({
      model,
      schema: args.schema,
      schemaName: args.schemaName,
      system: args.system,
      prompt: args.prompt,
    });
    return ok(result.object as T);
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
export async function runToolSubagent(args: {
  system: string;
  prompt: string;
  tools: ToolSet;
  maxSteps: number;
}): Promise<Result<ToolRunResult>> {
  try {
    const model = await getModel();
    const result = await generateText({
      model,
      system: args.system,
      prompt: args.prompt,
      tools: args.tools,
      stopWhen: stepCountIs(args.maxSteps),
    });
    return ok({ text: result.text, steps: result.steps.length });
  } catch (e) {
    return err(makeError('SubagentError', `tool subagent failed: ${msg(e)}`, e));
  }
}
