import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    vi.clearAllMocks();
    object.mockReturnValue(objectOutput);
    getModel.mockResolvedValue(model);
    generateText.mockResolvedValue({
      output: { answer: 'ok' },
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });
    generateObject.mockRejectedValue(new Error('generateObject should not be called'));
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
    });
    expect(generateObject).not.toHaveBeenCalled();
  });
});
