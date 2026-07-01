import { z } from 'zod';
import { runPlanSubagentDetailed, type SubagentRole } from './subagent.mjs';
import type { UsageMeter } from './cost.mjs';
import type {
  ContextCitation,
  ContextSpan,
  RecursiveContextResponder,
} from './recursive-context.mjs';

const RecursiveContextAnswerSchema = z.object({
  answer: z.string().describe('A concise answer grounded only in the provided spans.'),
  citationSpanIds: z
    .array(z.string())
    .min(1)
    .describe('Selected span IDs that directly support the answer.'),
});

export function makeRecursiveContextResponder(args: {
  readonly meter?: UsageMeter;
  readonly role?: SubagentRole;
}): RecursiveContextResponder {
  return async (request) => {
    const result = await runPlanSubagentDetailed({
      schema: RecursiveContextAnswerSchema,
      schemaName: 'RecursiveContextAnswer',
      system: [
        'You are a read-only recursive context cell in a glassBook notebook-agent.',
        'Answer only from the selected notebook/context spans supplied by the user.',
        'Do not infer from hidden state. Do not request tools. Do not describe repository edits.',
        'Cite the selected span IDs that directly support the answer.',
      ].join('\n'),
      prompt: [
        `Question: ${request.question}`,
        'Selected spans:',
        ...request.spans.map(formatSpan),
      ].join('\n\n'),
      role: args.role ?? 'planner',
      meter: args.meter,
    });

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const citations = citationsForSpanIds(result.value.output.citationSpanIds, request.spans);
    if (citations.length === 0) {
      throw new Error('recursive context answer did not cite any selected span id');
    }

    return {
      answer: result.value.output.answer,
      citations,
      usage: result.value.usage,
    };
  };
}

function formatSpan(span: ContextSpan): string {
  return [
    `Span ID: ${span.spanId}`,
    `Source: ${span.sourcePath}:${span.startLine}-${span.endLine}`,
    span.text,
  ].join('\n');
}

function citationsForSpanIds(
  spanIds: readonly string[],
  spans: readonly ContextSpan[],
): ContextCitation[] {
  const seen = new Set<string>();
  const citations: ContextCitation[] = [];
  for (const spanId of spanIds) {
    if (seen.has(spanId)) continue;
    seen.add(spanId);
    const span = spans.find((candidate) => candidate.spanId === spanId);
    if (!span) continue;
    citations.push({
      refId: span.refId,
      sourcePath: span.sourcePath,
      startLine: span.startLine,
      endLine: span.endLine,
      ...(span.cellId ? { cellId: span.cellId } : {}),
    });
  }
  return citations;
}
