import { describe, it, expect } from 'vitest';
import { AiProvider, getDefaultModel } from '@srcbook/shared';

describe('AI provider defaults', () => {
  it('uses current hosted-provider model ids', () => {
    expect(getDefaultModel(AiProvider.OpenAI)).toBe('gpt-5.5');
    expect(getDefaultModel(AiProvider.XAI)).toBe('grok-4.3');
    expect(getDefaultModel(AiProvider.Gemini)).toBe('gemini-3.5-flash');
  });
});
