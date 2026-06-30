import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

const objectOutput = { name: 'object-output' };
const model = { id: 'test-model' };

const generateText = vi.fn();
const generateObject = vi.fn();
const object = vi.fn();
const getModel = vi.fn();

vi.mock('ai', () => ({
  generateText,
  generateObject,
  stepCountIs: vi.fn((steps: number) => ({ type: 'step-count', steps })),
  Output: { object },
}));

vi.mock('@srcbook/api/headless', () => ({
  getModel,
}));

describe('runPlanSubagent', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    object.mockReturnValue(objectOutput);
    getModel.mockResolvedValue(model);
    generateText.mockResolvedValue({
      output: { answer: 'ok' },
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });
    generateObject.mockRejectedValue(new Error('generateObject should not be called'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses generateText with an object output spec', async () => {
    const { runPlanSubagent } = await import('./subagent.mjs');
    const schema = z.object({ answer: z.string() });

    const result = await runPlanSubagent({
      system: 'system prompt',
      prompt: 'user prompt',
      schema,
      schemaName: 'Answer',
      role: 'planner',
    });

    expect(result).toEqual({ ok: true, value: { answer: 'ok' } });
    expect(getModel).toHaveBeenCalledWith({ model: undefined });
    expect(object).toHaveBeenCalledWith({ schema, name: 'Answer' });
    expect(generateText).toHaveBeenCalledWith({
      model,
      output: objectOutput,
      system: 'system prompt',
      prompt: 'user prompt',
      abortSignal: expect.any(AbortSignal),
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('turns a hung model call into a typed subagent timeout failure', async () => {
    vi.useFakeTimers();
    const { runToolSubagent } = await import('./subagent.mjs');
    generateText.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
        }),
    );

    const resultPromise = runToolSubagent({
      system: 'system prompt',
      prompt: 'user prompt',
      tools: {},
      maxSteps: 1,
      retries: 0,
      modelTimeoutMs: 5,
    });
    await vi.advanceTimersByTimeAsync(5);

    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe('SubagentError');
      expect(result.error.message).toContain('timed out after 5ms');
    }
  });
});
