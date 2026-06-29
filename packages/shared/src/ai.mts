export const AiProvider = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  XAI: 'Xai',
  Gemini: 'Gemini',
  OpenRouter: 'openrouter',
  Custom: 'custom',
} as const;

export type AiProviderType = (typeof AiProvider)[keyof typeof AiProvider];

export const defaultModels: Record<AiProviderType, string> = {
  [AiProvider.OpenAI]: 'gpt-5.5',
  [AiProvider.Anthropic]: 'claude-haiku-4-5',
  [AiProvider.Custom]: 'mistral-nemo',
  [AiProvider.XAI]: 'grok-4.3',
  [AiProvider.Gemini]: 'gemini-3.5-flash',
  [AiProvider.OpenRouter]: 'anthropic/claude-haiku-4-5',
} as const;

export function isValidProvider(provider: string): provider is AiProviderType {
  return Object.values(AiProvider).includes(provider as AiProviderType);
}

export function getDefaultModel(provider: AiProviderType): string {
  return defaultModels[provider];
}
