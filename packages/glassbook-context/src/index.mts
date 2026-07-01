import { createHash } from 'node:crypto';

export type RecursiveContextErrorTag = 'ResearchError' | 'BudgetExceeded' | 'SubagentError';

export interface RecursiveContextError {
  readonly _tag: RecursiveContextErrorTag;
  readonly message: string;
  readonly cause?: unknown;
}

export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: RecursiveContextError };

export function ok<A>(value: A): Result<A> {
  return { ok: true, value };
}

export function err<A = never>(error: RecursiveContextError): Result<A> {
  return { ok: false, error };
}

export function makeRecursiveContextError(
  tag: RecursiveContextErrorTag,
  message: string,
  cause?: unknown,
): RecursiveContextError {
  return { _tag: tag, message, cause };
}

export interface TokenUsageLike {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
}

export type NotebookContextKind = 'notebook' | 'sidecar' | 'repo-snapshot';

export interface NotebookContextRef {
  readonly id: string;
  readonly kind: NotebookContextKind;
  readonly sourcePath: string;
  readonly contentHash: string;
  readonly cellIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ContextDocument {
  readonly ref: NotebookContextRef;
  readonly content: string;
}

export interface ContextSelector {
  readonly query?: string;
  readonly cellIds?: readonly string[];
  readonly maxSpans?: number;
  readonly maxCharsPerSpan?: number;
}

export interface ContextCitation {
  readonly refId: string;
  readonly sourcePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly cellId?: string;
}

export interface ContextSpan extends ContextCitation {
  readonly spanId: string;
  readonly text: string;
}

export interface RecursiveContextModelRequest {
  readonly question: string;
  readonly spans: readonly ContextSpan[];
}

export interface RecursiveContextModelResponse {
  readonly answer: string;
  readonly citations: readonly ContextCitation[];
  readonly usage?: TokenUsageLike;
}

export type RecursiveContextResponder = (
  request: RecursiveContextModelRequest,
) => Promise<RecursiveContextModelResponse>;

export type RecursiveContextCallStatus = 'ok' | 'failed';

export interface RecursiveContextCall {
  readonly parentCellId?: string;
  readonly depth: number;
  readonly question: string;
  readonly refs: readonly NotebookContextRef[];
  readonly selectedSpans: readonly ContextSpan[];
  readonly answer?: string;
  readonly citations: readonly ContextCitation[];
  readonly usage?: TokenUsageLike;
  readonly status: RecursiveContextCallStatus;
  readonly error?: string;
}

export interface RecursiveContextAnswer {
  readonly answer: string;
  readonly citations: readonly ContextCitation[];
  readonly selectedSpans: readonly ContextSpan[];
  readonly call: RecursiveContextCall;
}

export interface AskContextArgs {
  readonly parentCellId?: string;
  readonly question: string;
  readonly refs: readonly ContextDocument[];
  readonly selectors?: readonly ContextSelector[];
  readonly maxCalls?: number;
  readonly maxTokens?: number;
  readonly depth?: number;
  readonly responder: RecursiveContextResponder;
  readonly onCall?: (call: RecursiveContextCall) => void;
}

export const MAX_RECURSIVE_CONTEXT_DEPTH = 1;
export const DEFAULT_MAX_CALLS = 1;
export const DEFAULT_MAX_TOKENS = 8_000;
export const DEFAULT_MAX_SPANS = 6;
export const DEFAULT_MAX_CHARS_PER_SPAN = 2_000;

export function hashContextContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function makeNotebookContextRef(args: {
  readonly id?: string;
  readonly kind: NotebookContextKind;
  readonly sourcePath: string;
  readonly content: string;
  readonly cellIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}): NotebookContextRef {
  const contentHash = hashContextContent(args.content);
  return {
    id: args.id ?? `${args.kind}:${contentHash.slice(0, 12)}`,
    kind: args.kind,
    sourcePath: args.sourcePath,
    contentHash,
    ...(args.cellIds ? { cellIds: [...args.cellIds] } : {}),
    ...(args.metadata ? { metadata: { ...args.metadata } } : {}),
  };
}

export function selectContextSpans(args: {
  readonly refs: readonly ContextDocument[];
  readonly selectors?: readonly ContextSelector[];
}): ContextSpan[] {
  const selectors =
    args.selectors && args.selectors.length > 0
      ? args.selectors
      : [{ maxSpans: DEFAULT_MAX_SPANS, maxCharsPerSpan: DEFAULT_MAX_CHARS_PER_SPAN }];

  const spans: ContextSpan[] = [];
  for (const selector of selectors) {
    const maxSpans = selector.maxSpans ?? DEFAULT_MAX_SPANS;
    const maxCharsPerSpan = selector.maxCharsPerSpan ?? DEFAULT_MAX_CHARS_PER_SPAN;
    for (const doc of args.refs) {
      if (spans.length >= maxSpans) break;
      if (!matchesCellIds(doc.ref, selector.cellIds)) continue;
      spans.push(...selectFromDocument(doc, selector, maxSpans - spans.length, maxCharsPerSpan));
    }
  }
  return spans;
}

/** A cellIds filter matches only refs that declare an overlapping cell id; refs with no
 * declared cellIds are excluded rather than included by default, so a caller-supplied
 * filter can't be silently widened to the whole document set. */
function matchesCellIds(
  ref: NotebookContextRef,
  cellIds: readonly string[] | undefined,
): boolean {
  if (!cellIds || cellIds.length === 0) return true;
  return (ref.cellIds ?? []).some((id) => cellIds.includes(id));
}

export async function askContext(args: AskContextArgs): Promise<Result<RecursiveContextAnswer>> {
  const depth = args.depth ?? 1;
  if (depth > MAX_RECURSIVE_CONTEXT_DEPTH) {
    return err(
      makeRecursiveContextError(
        'BudgetExceeded',
        `recursive context depth ${depth} exceeds the v1 limit of ${MAX_RECURSIVE_CONTEXT_DEPTH}`,
      ),
    );
  }

  const maxCalls = args.maxCalls ?? DEFAULT_MAX_CALLS;
  if (maxCalls < 1) {
    return err(
      makeRecursiveContextError('BudgetExceeded', 'recursive context maxCalls must be at least 1'),
    );
  }

  if (args.refs.length === 0) {
    return err(
      makeRecursiveContextError(
        'ResearchError',
        'recursive context requires at least one context ref',
      ),
    );
  }

  const selectedSpans = selectContextSpans({ refs: args.refs, selectors: args.selectors });
  if (selectedSpans.length === 0) {
    return err(
      makeRecursiveContextError('ResearchError', 'recursive context selected no readable spans'),
    );
  }

  const estimatedTokens = estimateTokens(selectedSpans.map((span) => span.text).join('\n'));
  const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (estimatedTokens > maxTokens) {
    return err(
      makeRecursiveContextError(
        'BudgetExceeded',
        `recursive context selected context exceeds maxTokens (${estimatedTokens} > ${maxTokens})`,
      ),
    );
  }

  const refs = args.refs.map((doc) => doc.ref);
  try {
    const response = await args.responder({
      question: args.question,
      spans: selectedSpans,
    });
    const citationError = validateCitations(response.citations, selectedSpans);
    if (citationError) {
      args.onCall?.({
        parentCellId: args.parentCellId,
        depth,
        question: args.question,
        refs,
        selectedSpans,
        citations: [],
        usage: response.usage,
        status: 'failed',
        error: citationError,
      });
      return err(makeRecursiveContextError('ResearchError', citationError));
    }

    const call: RecursiveContextCall = {
      parentCellId: args.parentCellId,
      depth,
      question: args.question,
      refs,
      selectedSpans,
      answer: response.answer,
      citations: response.citations,
      usage: response.usage,
      status: 'ok',
    };
    args.onCall?.(call);
    return ok({
      answer: response.answer,
      citations: response.citations,
      selectedSpans,
      call,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const call: RecursiveContextCall = {
      parentCellId: args.parentCellId,
      depth,
      question: args.question,
      refs,
      selectedSpans,
      citations: [],
      status: 'failed',
      error: message,
    };
    args.onCall?.(call);
    return err(
      makeRecursiveContextError(
        'SubagentError',
        `recursive context subquery failed: ${message}`,
        cause,
      ),
    );
  }
}

function selectFromDocument(
  doc: ContextDocument,
  selector: ContextSelector,
  maxSpans: number,
  maxCharsPerSpan: number,
): ContextSpan[] {
  if (maxSpans <= 0) return [];

  const lines = doc.content.split(/\r?\n/);
  const matches = matchingLineIndexes(lines, selector.query);
  if (matches.length === 0 && selector.query) return [];
  if (matches.length === 0) return selectSequentialChunks(doc, lines, maxSpans, maxCharsPerSpan);

  const spans: ContextSpan[] = [];
  for (const index of matches) {
    if (spans.length >= maxSpans) break;
    const startIndex = Math.max(0, index - 1);
    const endIndex = Math.min(lines.length - 1, index + 1);
    const startLine = startIndex + 1;
    const endLine = endIndex + 1;
    const text = lines
      .slice(startIndex, endIndex + 1)
      .join('\n')
      .slice(0, maxCharsPerSpan);
    spans.push({
      spanId: `${doc.ref.id}:L${startLine}-L${endLine}`,
      refId: doc.ref.id,
      sourcePath: doc.ref.sourcePath,
      startLine,
      endLine,
      text,
    });
  }
  return spans;
}

function selectSequentialChunks(
  doc: ContextDocument,
  lines: readonly string[],
  maxSpans: number,
  maxCharsPerSpan: number,
): ContextSpan[] {
  const spans: ContextSpan[] = [];
  const linesPerChunk = 3;
  for (let startIndex = 0; startIndex < lines.length && spans.length < maxSpans; startIndex += 3) {
    const endIndex = Math.min(lines.length - 1, startIndex + linesPerChunk - 1);
    const startLine = startIndex + 1;
    const endLine = endIndex + 1;
    const text = lines
      .slice(startIndex, endIndex + 1)
      .join('\n')
      .slice(0, maxCharsPerSpan);
    if (!text.trim()) continue;
    spans.push({
      spanId: `${doc.ref.id}:L${startLine}-L${endLine}`,
      refId: doc.ref.id,
      sourcePath: doc.ref.sourcePath,
      startLine,
      endLine,
      text,
    });
  }
  return spans;
}

function matchingLineIndexes(lines: readonly string[], query: string | undefined): number[] {
  if (!query || !query.trim()) return [];
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];

  const phrase = query.toLowerCase();
  const directMatches: number[] = [];
  const termMatches: number[] = [];
  for (const [index, line] of lines.entries()) {
    const normalized = line.toLowerCase();
    if (normalized.includes(phrase)) {
      directMatches.push(index);
    } else if (terms.every((term) => normalized.includes(term))) {
      termMatches.push(index);
    }
  }
  return directMatches.length > 0 ? directMatches : termMatches;
}

function validateCitations(
  citations: readonly ContextCitation[],
  selectedSpans: readonly ContextSpan[],
): string | null {
  if (citations.length === 0) {
    return 'recursive context answers must include at least one citation';
  }

  for (const citation of citations) {
    const matched = selectedSpans.some(
      (span) =>
        span.refId === citation.refId &&
        span.sourcePath === citation.sourcePath &&
        span.startLine <= citation.startLine &&
        span.endLine >= citation.endLine,
    );
    if (!matched) {
      return 'recursive context citation does not match selected context';
    }
  }
  return null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
