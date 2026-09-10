import { OpenRouterClient, GenerateResponseOptions as OpenRouterOptions, GenerateResponseResult as OpenRouterResult } from '../openrouter/client.js';
import { GeminiClient, GeminiResponseOptions, GeminiResponseResult } from '../gemini/client.js';
import { OpenAIClient } from '../openai/client.js';
import { OpenAIResponseOptions, OpenAIResponseResult } from '../openai/types.js';
import { ModelManager } from '../openrouter/modelManager.js';
import { config } from '../config.js';

export type ProviderType = 'auto' | 'gemini' | 'openrouter' | 'openai';

export type LLMOptions = OpenRouterOptions & GeminiResponseOptions & OpenAIResponseOptions;

export interface LLMResult {
  content: string;
  usedModel: string;
  retriesCount: number;
  provider: 'gemini' | 'openrouter' | 'openai';
}

export class LLMRouter {
  private static instance: LLMRouter;
  private activeProvider: ProviderType = config.LLM_PROVIDER;
  private webSearchEnabled: boolean = config.ENABLE_WEB_SEARCH;

  private constructor() {}

  public static getInstance(): LLMRouter {
    if (!LLMRouter.instance) {
      LLMRouter.instance = new LLMRouter();
    }
    return LLMRouter.instance;
  }

  public getActiveProvider(): ProviderType {
    return this.activeProvider;
  }

  public setActiveProvider(provider: ProviderType): void {
    this.activeProvider = provider;
    console.log(`[ROUTER] Switched active provider to: [${provider.toUpperCase()}]`);
  }

  public isWebSearchEnabled(): boolean {
    return this.webSearchEnabled;
  }

  public toggleWebSearch(enabled?: boolean): boolean {
    this.webSearchEnabled = enabled !== undefined ? enabled : !this.webSearchEnabled;
    console.log(`[ROUTER] Web search toggled: [${this.webSearchEnabled ? 'ON' : 'OFF'}]`);
    return this.webSearchEnabled;
  }

  public getActiveModel(): string {
    if (this.activeProvider === 'openai') {
      return OpenAIClient.getInstance().getActiveModel();
    }
    if (this.activeProvider === 'gemini') {
      return GeminiClient.getInstance().getActiveModel();
    }
    if (this.activeProvider === 'openrouter') {
      return ModelManager.getInstance().getActiveTextModel();
    }
    // In auto mode, inspect top provider
    const hasOpenAI = config.openaiApiKeys.length > 0 || (config.OPENAI_API_BASE && !config.OPENAI_API_BASE.includes('api.openai.com'));
    if (hasOpenAI) return OpenAIClient.getInstance().getActiveModel();
    if (config.geminiApiKeys.length > 0) return GeminiClient.getInstance().getActiveModel();
    return ModelManager.getInstance().getActiveTextModel();
  }

  public setActiveModel(model: string, provider?: ProviderType): void {
    const targetProvider = provider || this.activeProvider;
    if (targetProvider === 'openai' || (targetProvider === 'auto' && config.openaiApiKeys.length > 0)) {
      OpenAIClient.getInstance().setActiveModel(model);
    } else if (targetProvider === 'gemini' || (targetProvider === 'auto' && config.geminiApiKeys.length > 0)) {
      GeminiClient.getInstance().setActiveModel(model);
    } else if (targetProvider === 'openrouter' || targetProvider === 'auto') {
      ModelManager.getInstance().setActiveTextModel(model);
    }
  }

  public getAvailableModels(provider?: ProviderType): string[] {
    const target = provider || this.activeProvider;
    if (target === 'openai') {
      return OpenAIClient.getInstance().getAvailableModels();
    }
    if (target === 'gemini') {
      return GeminiClient.getInstance().getAvailableModels();
    }
    if (target === 'openrouter') {
      return ModelManager.getInstance().getTextModels();
    }
    // auto: combine popular models
    return [
      ...OpenAIClient.getInstance().getAvailableModels().slice(0, 3),
      ...GeminiClient.getInstance().getAvailableModels().slice(0, 3),
      ...ModelManager.getInstance().getTextModels().slice(0, 3),
    ];
  }

  public getProviderStatus() {
    const hasOpenRouter = config.openRouterApiKeys && config.openRouterApiKeys.length > 0;
    const hasGemini = config.geminiApiKeys && config.geminiApiKeys.length > 0;
    const hasOpenAI =
      (config.openaiApiKeys && config.openaiApiKeys.length > 0) ||
      (config.OPENAI_API_BASE && !config.OPENAI_API_BASE.includes('api.openai.com'));

    return {
      activeProvider: this.activeProvider,
      activeModel: this.getActiveModel(),
      webSearchEnabled: this.webSearchEnabled,
      openai: {
        configured: hasOpenAI,
        keysCount: config.openaiApiKeys.length,
        baseUrl: OpenAIClient.getInstance().getBaseUrl(),
        model: OpenAIClient.getInstance().getActiveModel(),
      },
      gemini: {
        configured: hasGemini,
        keysCount: config.geminiApiKeys.length,
        model: GeminiClient.getInstance().getActiveModel(),
      },
      openrouter: {
        configured: hasOpenRouter,
        keysCount: config.openRouterApiKeys.length,
        model: ModelManager.getInstance().getActiveTextModel(),
        modelsCount: ModelManager.getInstance().getTextModels().length,
      },
    };
  }

  /**
   * Routes completion request to active provider (OpenAI, Gemini, or OpenRouter) with intelligent cross-provider failover
   */
  public async generateChatCompletion(options: LLMOptions): Promise<LLMResult> {
    const providerSetting = this.activeProvider;
    const hasGemini = config.geminiApiKeys && config.geminiApiKeys.length > 0;
    const hasOpenRouter = config.openRouterApiKeys && config.openRouterApiKeys.length > 0;
    const hasOpenAI =
      (config.openaiApiKeys && config.openaiApiKeys.length > 0) ||
      (config.OPENAI_API_BASE && !config.OPENAI_API_BASE.includes('api.openai.com'));

    if (!hasGemini && !hasOpenRouter && !hasOpenAI) {
      throw new Error(
        'No LLM API keys found. Please configure OPENAI_API_KEYS, GEMINI_API_KEYS, or OPENROUTER_API_KEYS in .env.'
      );
    }

    const callOpenAI = async (): Promise<LLMResult> => {
      const res = await OpenAIClient.getInstance().generateChatCompletion(options);
      return { ...res, provider: 'openai' };
    };

    const callGemini = async (): Promise<LLMResult> => {
      const res = await GeminiClient.getInstance().generateChatCompletion(options);
      return { ...res, provider: 'gemini' };
    };

    const callOpenRouter = async (): Promise<LLMResult> => {
      const res = await OpenRouterClient.getInstance().generateChatCompletion(options);
      return { ...res, provider: 'openrouter' };
    };

    // Explicit OpenAI mode
    if (providerSetting === 'openai') {
      try {
        return await callOpenAI();
      } catch (err: any) {
        console.warn(`[ROUTER] OpenAI provider failed (${err.message}). Attempting fallback...`);
        if (hasGemini) {
          console.warn('[ROUTER] Falling back to Gemini...');
          return await callGemini();
        }
        if (hasOpenRouter) {
          console.warn('[ROUTER] Falling back to OpenRouter...');
          return await callOpenRouter();
        }
        throw err;
      }
    }

    // Explicit Gemini mode
    if (providerSetting === 'gemini') {
      try {
        return await callGemini();
      } catch (err: any) {
        console.warn(`[ROUTER] Gemini provider failed (${err.message}). Attempting fallback...`);
        if (hasOpenAI) {
          console.warn('[ROUTER] Falling back to OpenAI...');
          return await callOpenAI();
        }
        if (hasOpenRouter) {
          console.warn('[ROUTER] Falling back to OpenRouter...');
          return await callOpenRouter();
        }
        throw err;
      }
    }

    // Explicit OpenRouter mode
    if (providerSetting === 'openrouter') {
      try {
        return await callOpenRouter();
      } catch (err: any) {
        console.warn(`[ROUTER] OpenRouter provider failed (${err.message}). Attempting fallback...`);
        if (hasOpenAI) {
          console.warn('[ROUTER] Falling back to OpenAI...');
          return await callOpenAI();
        }
        if (hasGemini) {
          console.warn('[ROUTER] Falling back to Gemini...');
          return await callGemini();
        }
        throw err;
      }
    }

    // Auto mode: prioritize OpenAI -> Gemini -> OpenRouter
    const chain: Array<() => Promise<LLMResult>> = [];
    if (hasOpenAI) chain.push(callOpenAI);
    if (hasGemini) chain.push(callGemini);
    if (hasOpenRouter) chain.push(callOpenRouter);

    let lastError: Error | null = null;
    for (const invoke of chain) {
      try {
        return await invoke();
      } catch (err: any) {
        lastError = err;
        console.warn(`[ROUTER] Provider failed in auto mode (${err.message}). Trying next available provider...`);
      }
    }

    throw lastError || new Error('All available LLM providers failed.');
  }
}

