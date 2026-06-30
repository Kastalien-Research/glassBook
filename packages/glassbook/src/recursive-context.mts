import { makeGlassbookCell } from './cell.mjs';
import type { GlassbookCell } from './cell.mjs';
import type { GlassbookState } from './types.mjs';
import type { RecursiveContextCall } from '@kastalien-research/glassbook-context';

export {
  DEFAULT_MAX_CALLS,
  DEFAULT_MAX_CHARS_PER_SPAN,
  DEFAULT_MAX_SPANS,
  DEFAULT_MAX_TOKENS,
  MAX_RECURSIVE_CONTEXT_DEPTH,
  askContext,
  hashContextContent,
  makeNotebookContextRef,
  makeRecursiveContextError,
  selectContextSpans,
} from '@kastalien-research/glassbook-context';
export type {
  AskContextArgs,
  ContextCitation,
  ContextDocument,
  ContextSelector,
  ContextSpan,
  NotebookContextKind,
  NotebookContextRef,
  RecursiveContextAnswer,
  RecursiveContextCall,
  RecursiveContextCallStatus,
  RecursiveContextError,
  RecursiveContextErrorTag,
  RecursiveContextModelRequest,
  RecursiveContextModelResponse,
  RecursiveContextResponder,
  Result as RecursiveContextResult,
  TokenUsageLike,
} from '@kastalien-research/glassbook-context';

export function recordRecursiveContextCall(
  state: GlassbookState,
  call: RecursiveContextCall,
): void {
  state.recursiveContextCalls.push(call);
  state.glassbookCells.push(makeRecursiveContextCell(call));
}

export function makeRecursiveContextCell(call: RecursiveContextCall): GlassbookCell {
  return makeGlassbookCell({
    section: 'research',
    input: {
      parentCellId: call.parentCellId,
      question: call.question,
    },
    processing: {
      depth: call.depth,
      refs: call.refs.map((ref) => ref.id),
      selectedSpans: call.selectedSpans.map((span) => span.spanId),
    },
    output: {
      status: call.status,
      answer: call.answer,
      citations: call.citations,
      error: call.error,
    },
    gates: [],
  });
}
