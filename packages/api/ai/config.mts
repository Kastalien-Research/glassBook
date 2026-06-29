import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getConfig } from '../config.mjs';
import type { LanguageModel } from 'ai';
import { getDefaultModel, type AiProviderType } from '@srcbook/shared';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Get the correct client and model configuration.
 * Throws an error if the given API key is not set in the settings.
 */
export async function getModel(): Promise<LanguageModel> {
  const config = await getConfig();

  // Environment variables take precedence over the SQLite config. This is what
  // makes a `.env` file work for headless runs (e.g. glassBook) without the web
  // settings UI. The AI SDK providers also read some of these by default, but we
  // resolve them explicitly so the "key is not set" checks stay accurate.
  const provider =
    (process.env.SRCBOOK_AI_PROVIDER as AiProviderType | undefined) ||
    (config.aiProvider as AiProviderType);
  const model = process.env.SRCBOOK_AI_MODEL || config.aiModel || getDefaultModel(provider);
  const aiBaseUrl = process.env.SRCBOOK_AI_BASE_URL || config.aiBaseUrl;

  const openaiKey = process.env.OPENAI_API_KEY || config.openaiKey;
  const anthropicKey = process.env.ANTHROPIC_API_KEY || config.anthropicKey;
  const geminiKey = process.env.GEMINI_API_KEY || config.geminiKey;
  const xaiKey = process.env.XAI_API_KEY || config.xaiKey;
  const openrouterKey = process.env.OPENROUTER_API_KEY || config.openrouterKey;
  const customApiKey = process.env.SRCBOOK_CUSTOM_API_KEY || config.customApiKey;

  switch (provider) {
    case 'openai': {
      if (!openaiKey) {
        throw new Error('OpenAI API key is not set');
      }
      return createOpenAI({ apiKey: openaiKey }).chat(model);
    }

    case 'anthropic': {
      if (!anthropicKey) {
        throw new Error('Anthropic API key is not set');
      }
      return createAnthropic({ apiKey: anthropicKey })(model);
    }

    case 'Gemini': {
      if (!geminiKey) {
        throw new Error('Gemini API key is not set');
      }
      return createGoogleGenerativeAI({ apiKey: geminiKey })(model) as LanguageModel;
    }

    case 'Xai': {
      if (!xaiKey) {
        throw new Error('Xai API key is not set');
      }
      return createOpenAI({ baseURL: 'https://api.x.ai/v1', apiKey: xaiKey }).chat(model);
    }

    case 'openrouter': {
      if (!openrouterKey) {
        throw new Error('OpenRouter API key is not set');
      }
      return createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: openrouterKey }).chat(
        model,
      );
    }

    case 'custom': {
      if (typeof aiBaseUrl !== 'string') {
        throw new Error('Local AI base URL is not set');
      }
      // use custom API key if set, otherwise use a bogus key
      return createOpenAI({ apiKey: customApiKey || 'bogus', baseURL: aiBaseUrl }).chat(model);
    }

    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown AI provider: ${String(_exhaustive)}`);
    }
  }
}
