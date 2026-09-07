import { OpenRouterClient, GenerateResponseOptions as OpenRouterOptions, GenerateResponseResult as OpenRouterResult } from '../openrouter/client.js';
import { GeminiClient, GeminiResponseOptions, GeminiResponseResult } from '../gemini/client.js';
import { config } from '../config.js';

export type LLMOptions = OpenRouterOptions & GeminiResponseOptions;

export interface LLMResult {
  content: string;
  usedModel: string;
  retriesCount: number;
  provider: 'gemini' | 'openrouter';
}

export class LLMRouter {
  private static instance: LLMRouter;

  private constructor() {}

  public static getInstance(): LLMRouter {
    if (!LLMRouter.instance) {
      LLMRouter.instance = new LLMRouter();
    }
    return LLMRouter.instance;
  }

  /**
   * Routes completion request to active provider (Gemini or OpenRouter) with intelligent cross-provider failover
   */
  public async generateChatCompletion(options: LLMOptions): Promise<LLMResult> {
    const providerSetting = config.LLM_PROVIDER;
    const hasGemini = config.geminiApiKeys && config.geminiApiKeys.length > 0;
    const hasOpenRouter = config.openRouterApiKeys && config.openRouterApiKeys.length > 0;

    if (!hasGemini && !hasOpenRouter) {
      throw new Error(
        'No LLM API keys found. Please configure GEMINI_API_KEYS or OPENROUTER_API_KEYS in .env.'
      );
    }

    // Explicit Gemini mode
    if (providerSetting === 'gemini') {
      try {
        const res = await GeminiClient.getInstance().generateChatCompletion(options);
        return { ...res, provider: 'gemini' };
      } catch (err: any) {
        if (hasOpenRouter) {
          console.warn(`[ROUTER] Gemini provider failed (${err.message}). Falling back to OpenRouter...`);
          const res = await OpenRouterClient.getInstance().generateChatCompletion(options);
          return { ...res, provider: 'openrouter' };
        }
        throw err;
      }
    }

    // Explicit OpenRouter mode
    if (providerSetting === 'openrouter') {
      try {
        const res = await OpenRouterClient.getInstance().generateChatCompletion(options);
        return { ...res, provider: 'openrouter' };
      } catch (err: any) {
        if (hasGemini) {
          console.warn(`[ROUTER] OpenRouter provider failed (${err.message}). Falling back to Gemini...`);
          const res = await GeminiClient.getInstance().generateChatCompletion(options);
          return { ...res, provider: 'gemini' };
        }
        throw err;
      }
    }

    // Auto mode: prioritize Gemini if key is present, fallback to OpenRouter
    if (hasGemini) {
      try {
        const res = await GeminiClient.getInstance().generateChatCompletion(options);
        return { ...res, provider: 'gemini' };
      } catch (err: any) {
        console.warn(`[ROUTER] Gemini attempt failed in auto mode (${err.message}).`);
        if (hasOpenRouter) {
          console.warn('[ROUTER] Auto-switching to OpenRouter...');
          const res = await OpenRouterClient.getInstance().generateChatCompletion(options);
          return { ...res, provider: 'openrouter' };
        }
        throw err;
      }
    } else {
      // Auto mode with OpenRouter
      const res = await OpenRouterClient.getInstance().generateChatCompletion(options);
      return { ...res, provider: 'openrouter' };
    }
  }
}

