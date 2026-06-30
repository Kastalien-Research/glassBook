import { z } from 'zod';
import { runToolSubagent, runPlanSubagent } from '../subagent.mjs';
import { makeReadOnlyTools } from '../tools.mjs';
import { ResearchFindingsSchema, type ResearchFindings, type Plan } from '../schemas.mjs';
import { consumeBudget, budgetRemaining, type SectionContext } from '../context.mjs';
import { ok, type Result } from '../types.mjs';
import {
  askContext,
  makeNotebookContextRef,
  makeRecursiveContextCell,
  type RecursiveContextCall,
} from '../recursive-context.mjs';
import { makeRecursiveContextResponder } from '../recursive-context-subagent.mjs';
import type { GlassbookCell } from '../cell.mjs';

/**
 * Section 3 — Research.
 *
 * "What must be known before work begins (accessible vs not)?" Rather than a
 * single pass, research now FANS OUT: a planner proposes up to `budget` distinct,
 * independently-investigable questions, each is investigated in its own read-only
 * cell (consuming one unit of the research budget), and a planner then synthesizes
 * structured findings across all of them. Falls back to a single investigation if
 * question-planning yields nothing.
 */

const ResearchQuestionsSchema = z.object({
  questions: z
    .array(z.string())
    .describe('Distinct, independently-investigable questions to answer before work begins.'),
});

/** Step ceiling for each focused per-question investigation. */
const STEPS_PER_QUESTION = 14;
const RECURSIVE_CONTEXT_MAX_SPANS = 6;
const RECURSIVE_CONTEXT_MAX_CHARS_PER_SPAN = 1_600;
const RECURSIVE_CONTEXT_MAX_TOKENS = 6_000;

export interface ResearchSectionResult {
  readonly findings: ResearchFindings;
  readonly recursiveContextCalls: readonly RecursiveContextCall[];
  readonly glassbookCells: readonly GlassbookCell[];
}

export async function runResearch(
  ctx: SectionContext,
  plan: Plan,
): Promise<Result<ResearchSectionResult>> {
  const { state, emitter, logger } = ctx;
  logger.section('3 · Research');

  const tools = makeReadOnlyTools(ctx.repoDir);
  const budget = Math.max(1, budgetRemaining(state, 'research'));
  const recursiveContextEnabled = budget > 1;
  const investigationBudget = recursiveContextEnabled ? budget - 1 : budget;

  // 1. Plan distinct research questions (bounded by the research budget).
  const planned = await runPlanSubagent({
    schema: ResearchQuestionsSchema,
    schemaName: 'ResearchQuestions',
    system: [
      'You are planning the research cell of a glassBook notebook-agent.',
      'Propose distinct, independently-investigable questions that MUST be answered before work can begin.',
      'Each question should be answerable on its own by reading the repo or the web. Prefer fewer, higher-value questions.',
    ].join('\n'),
    prompt: [
      `Objective: ${state.prompt}`,
      `Goal: ${plan.goal}`,
      `Proposed gate commands to validate:\n${plan.finalGates.map((g) => `- ${g.command}`).join('\n')}`,
      `Propose at most ${investigationBudget} question(s).`,
    ].join('\n\n'),
    role: 'planner',
    meter: ctx.meter,
  });

  const questions: string[] =
    planned.ok && planned.value.questions.length > 0
      ? planned.value.questions.slice(0, investigationBudget)
      : [`What must be known before work can begin to accomplish: ${state.prompt}?`];

  await emitter.section(
    'Research — Plan',
    `Investigating ${questions.length} question(s):\n${questions.map((q) => `- ${q}`).join('\n')}`,
  );

  // 2. Investigate each question in its own read-only cell, consuming budget.
  const investigations: string[] = [];
  for (const [i, question] of questions.entries()) {
    const consumed = consumeBudget(state, 'research', 1);
    if (!consumed.ok) {
      logger.warn(`research budget exhausted after ${i} question(s)`);
      break;
    }

    const inv = await runToolSubagent({
      system: [
        'You are a research cell of a glassBook notebook-agent investigating ONE question.',
        'Use the tools to read files, search code, and run READ-ONLY shell commands (e.g. listing tests, checking how to run them).',
        'You must NOT modify, create, or delete any files, and must NOT run commands that change the repository.',
        'Finish with a focused, evidence-backed answer that cites file paths / commands.',
      ].join('\n'),
      prompt: [
        `Question to answer: ${question}`,
        `\nObjective: ${state.prompt}`,
        `Goal: ${plan.goal}`,
      ].join('\n'),
      tools,
      maxSteps: STEPS_PER_QUESTION,
      role: 'worker',
      meter: ctx.meter,
    });

    const text = inv.ok ? inv.value.text : `(investigation failed: ${inv.error.message})`;
    investigations.push(`### Q${i + 1}: ${question}\n\n${text}`);
    await emitter.section(`Research — Investigation ${i + 1}`, `**${question}**\n\n${text}`);
  }

  // 3. Ask one bounded recursive context question over the investigation transcript.
  const recursiveContextCalls: RecursiveContextCall[] = [];
  const glassbookCells: GlassbookCell[] = [];
  const recursiveContext = await runRecursiveResearchContext(ctx, plan, {
    enabled: recursiveContextEnabled,
    investigations,
  });
  if (recursiveContext.call) {
    recursiveContextCalls.push(recursiveContext.call);
    glassbookCells.push(makeRecursiveContextCell(recursiveContext.call));
  }

  // 4. Synthesize structured findings across all investigations plus recursive context.
  const synthesisPrompt = [investigations.join('\n\n---\n\n'), recursiveContext.synthesisText]
    .filter(Boolean)
    .join('\n\n---\n\n');
  const synth = await runPlanSubagent({
    schema: ResearchFindingsSchema,
    schemaName: 'ResearchFindings',
    system:
      'Convert the research investigations into structured findings. knownBeforeWork = necessary AND accessible now; unknowableBeforeWork = necessary but only discoverable during work.',
    prompt: synthesisPrompt,
    role: 'planner',
    meter: ctx.meter,
  });
  if (!synth.ok) return synth;

  await emitter.section(
    'Research — Findings',
    [
      `**Summary:** ${synth.value.summary}`,
      `\n**Known before work:**\n${synth.value.knownBeforeWork
        .map((a) => `- ${a.question} → ${a.answer} _(${a.source})_`)
        .join('\n')}`,
      synth.value.unknowableBeforeWork.length
        ? `\n**Not knowable before work:**\n- ${synth.value.unknowableBeforeWork.join('\n- ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  logger.success(`research done across ${investigations.length} investigation(s)`);
  return ok({
    findings: synth.value,
    recursiveContextCalls,
    glassbookCells,
  });
}

async function runRecursiveResearchContext(
  ctx: SectionContext,
  plan: Plan,
  args: {
    readonly enabled: boolean;
    readonly investigations: readonly string[];
  },
): Promise<{ readonly call?: RecursiveContextCall; readonly synthesisText?: string }> {
  if (!args.enabled || args.investigations.length === 0) return {};

  const consumed = consumeBudget(ctx.state, 'research', 1);
  if (!consumed.ok) {
    ctx.logger.warn('research budget exhausted before recursive context');
    return {};
  }

  const content = args.investigations.join('\n\n---\n\n');
  const ref = makeNotebookContextRef({
    id: 'research-investigations',
    kind: 'notebook',
    sourcePath: `${ctx.state.notebookDir ?? 'glassbook'}#research-investigations`,
    content,
    metadata: {
      section: 'research',
      questionCount: args.investigations.length,
    },
  });
  const question = [
    'What evidence from the research investigations is most important before work begins?',
    `Objective: ${ctx.state.prompt}`,
    `Goal: ${plan.goal}`,
  ].join('\n');

  let recordedCall: RecursiveContextCall | undefined;
  const answer = await askContext({
    parentCellId: 'research',
    question,
    refs: [{ ref, content }],
    selectors: [
      {
        maxSpans: RECURSIVE_CONTEXT_MAX_SPANS,
        maxCharsPerSpan: RECURSIVE_CONTEXT_MAX_CHARS_PER_SPAN,
      },
    ],
    maxCalls: 1,
    maxTokens: RECURSIVE_CONTEXT_MAX_TOKENS,
    responder: makeRecursiveContextResponder({ meter: ctx.meter, role: 'planner' }),
    onCall: (call) => {
      recordedCall = call;
    },
  });

  const call = recordedCall;
  if (call) {
    await ctx.emitter.section('Research — Recursive Context', formatRecursiveContextCall(call));
    if (call.status === 'ok' && call.answer) {
      return {
        call,
        synthesisText: [
          '### Recursive context answer',
          call.answer,
          '',
          'Citations:',
          ...call.citations.map(
            (citation) => `- ${citation.sourcePath}:${citation.startLine}-${citation.endLine}`,
          ),
        ].join('\n'),
      };
    }
    return {
      call,
      synthesisText: `### Recursive context answer\nRecursive context failed: ${
        call.error ?? 'unknown error'
      }`,
    };
  }

  if (!answer.ok) {
    await ctx.emitter.section(
      'Research — Recursive Context',
      `Recursive context was not recorded: ${answer.error.message}`,
    );
  }
  return {};
}

function formatRecursiveContextCall(call: RecursiveContextCall): string {
  const citations = call.citations.length
    ? call.citations
        .map((citation) => `- ${citation.sourcePath}:${citation.startLine}-${citation.endLine}`)
        .join('\n')
    : '- none';
  const spans = call.selectedSpans.map((span) => `- ${span.spanId}`).join('\n');
  return [
    `**Status:** ${call.status}`,
    `\n**Question:**\n${call.question}`,
    `\n**Selected spans:**\n${spans}`,
    call.answer ? `\n**Answer:**\n${call.answer}` : '',
    `\n**Citations:**\n${citations}`,
    call.error ? `\n**Error:** ${call.error}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
