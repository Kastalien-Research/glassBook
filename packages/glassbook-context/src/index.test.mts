import { describe, expect, it } from 'vitest';
import {
  askContext,
  makeNotebookContextRef,
  selectContextSpans,
  type RecursiveContextResponder,
} from './index.mjs';

describe('recursive context refs', () => {
  it('builds stable hashable notebook refs without embedding mutable content', () => {
    const ref = makeNotebookContextRef({
      kind: 'notebook',
      sourcePath: '/tmp/notebooks/run.src.md',
      content: '# Run\n\n## Cell A\n\nRevenue grew 12%.',
      cellIds: ['cell-a'],
      metadata: { sidecarPath: '/tmp/notebooks/glassbook.json' },
    });

    expect(ref).toEqual({
      id: 'notebook:d5a42be5b127',
      kind: 'notebook',
      sourcePath: '/tmp/notebooks/run.src.md',
      contentHash: 'd5a42be5b127799acba826e65b08255c65cbfbf86f47f409e7e26bb1e0ba637d',
      cellIds: ['cell-a'],
      metadata: { sidecarPath: '/tmp/notebooks/glassbook.json' },
    });
    expect(ref).not.toHaveProperty('content');
  });

  it('selects bounded cited spans from long notebook content', () => {
    const content = [
      '# Research notebook',
      '## Cell A',
      'irrelevant setup',
      '## Cell B',
      'The target company changed guidance after the March call.',
      'This line should be in the selected span.',
      '## Cell C',
      'unrelated appendix',
    ].join('\n');
    const ref = makeNotebookContextRef({
      kind: 'notebook',
      sourcePath: '/tmp/research.src.md',
      content,
    });

    const spans = selectContextSpans({
      refs: [{ ref, content }],
      selectors: [{ query: 'changed guidance', maxSpans: 1, maxCharsPerSpan: 140 }],
    });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      refId: ref.id,
      sourcePath: '/tmp/research.src.md',
      startLine: 4,
      endLine: 6,
    });
    expect(spans[0].text).toContain('changed guidance');
    expect(spans[0].text.length).toBeLessThanOrEqual(140);
  });

  it('selects multiple bounded chunks when no query is provided', () => {
    const content = Array.from(
      { length: 12 },
      (_, i) => `line ${String(i + 1).padStart(2, '0')} research evidence`,
    ).join('\n');
    const ref = makeNotebookContextRef({
      kind: 'notebook',
      sourcePath: '/tmp/research.src.md',
      content,
    });

    const spans = selectContextSpans({
      refs: [{ ref, content }],
      selectors: [{ maxSpans: 3, maxCharsPerSpan: 80 }],
    });

    expect(spans).toHaveLength(3);
    expect(spans.map((span) => span.startLine)).toEqual([1, 4, 7]);
    expect(spans.map((span) => span.endLine)).toEqual([3, 6, 9]);
    expect(new Set(spans.map((span) => span.spanId)).size).toBe(3);
    expect(spans.every((span) => span.text.length <= 80)).toBe(true);
  });
});

describe('askContext', () => {
  const content = [
    '# Long notebook',
    ...Array.from({ length: 30 }, (_, i) => `ordinary line ${i}`),
    'Needle: the approved research artifact is an earnings-update recipe notebook.',
    ...Array.from({ length: 30 }, (_, i) => `appendix line ${i}`),
  ].join('\n');
  const ref = makeNotebookContextRef({
    kind: 'notebook',
    sourcePath: '/tmp/long.src.md',
    content,
  });

  it('answers through a depth-1 read-only subquery with citations and usage', async () => {
    let seenRequest: unknown;
    const responder: RecursiveContextResponder = async (request) => {
      seenRequest = request;
      return {
        answer: 'The artifact is an earnings-update recipe notebook.',
        citations: [
          {
            refId: request.spans[0].refId,
            sourcePath: request.spans[0].sourcePath,
            startLine: request.spans[0].startLine,
            endLine: request.spans[0].endLine,
          },
        ],
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      };
    };

    const result = await askContext({
      parentCellId: 'research-cell',
      question: 'What artifact should the product prove?',
      refs: [{ ref, content }],
      selectors: [{ query: 'approved research artifact', maxSpans: 1 }],
      responder,
      maxCalls: 1,
      maxTokens: 300,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.answer).toBe('The artifact is an earnings-update recipe notebook.');
      expect(result.value.call).toMatchObject({
        parentCellId: 'research-cell',
        depth: 1,
        question: 'What artifact should the product prove?',
        status: 'ok',
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      });
      expect(result.value.call.selectedSpans).toHaveLength(1);
      expect(result.value.call.citations).toHaveLength(1);
    }
    expect(seenRequest).not.toHaveProperty('tools');
    expect(JSON.stringify(seenRequest)).not.toContain('writeFile');
    expect(JSON.stringify(seenRequest)).not.toContain('execute-code');
    expect(JSON.stringify(seenRequest)).not.toContain('mcp__');
  });

  it('rejects recursive depth above the v1 limit', async () => {
    const result = await askContext({
      question: 'too deep',
      refs: [{ ref, content }],
      depth: 2,
      responder: async () => ({
        answer: 'no',
        citations: [],
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe('BudgetExceeded');
      expect(result.error.message).toContain('depth 2 exceeds the v1 limit of 1');
    }
  });

  it('rejects exhausted call and token budgets', async () => {
    const noCalls = await askContext({
      question: 'budget',
      refs: [{ ref, content }],
      maxCalls: 0,
      responder: async () => ({ answer: 'no', citations: [] }),
    });
    expect(noCalls.ok).toBe(false);
    if (!noCalls.ok) expect(noCalls.error.message).toContain('maxCalls must be at least 1');

    const noTokens = await askContext({
      question: 'budget',
      refs: [{ ref, content }],
      selectors: [{ query: 'Needle', maxSpans: 1 }],
      maxTokens: 1,
      responder: async () => ({ answer: 'no', citations: [] }),
    });
    expect(noTokens.ok).toBe(false);
    if (!noTokens.ok)
      expect(noTokens.error.message).toContain('selected context exceeds maxTokens');
  });

  it('rejects uncited or invalid recursive answers and records the failed call', async () => {
    const recorded = [];
    const uncited = await askContext({
      question: 'uncited',
      refs: [{ ref, content }],
      selectors: [{ query: 'Needle', maxSpans: 1 }],
      responder: async () => ({
        answer: 'uncited answer',
        citations: [],
      }),
      onCall: (call) => recorded.push(call),
    });
    expect(uncited.ok).toBe(false);
    if (!uncited.ok) expect(uncited.error.message).toContain('at least one citation');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ status: 'failed' });

    const invalid = await askContext({
      question: 'invalid citation',
      refs: [{ ref, content }],
      selectors: [{ query: 'Needle', maxSpans: 1 }],
      responder: async () => ({
        answer: 'bad cite',
        citations: [{ refId: 'missing', sourcePath: '/tmp/missing', startLine: 1, endLine: 1 }],
      }),
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.error.message).toContain('citation does not match selected context');
  });
});
