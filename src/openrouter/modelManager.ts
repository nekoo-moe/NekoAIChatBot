import axios from 'axios';
import { OpenRouterModel, OpenRouterModelsResponse } from './types.js';
import { config } from '../config.js';

// Curated high-performing free text models ranked by instruction-following, context size, and roleplay ability
export const CURATED_FREE_TEXT_MODELS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'minimax/minimax-m3:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'poolside/laguna-s-2.1:free',
  'nvidia/nemotron-3.5-lightning:free',
  'inclusionai/ling-3.0-flash-fin:free',
  'minimax/minimax-m2.7:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'poolside/laguna-xs-2.1:free',
  'inclusionai/ling-3.0-flash-sante:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'cohere/north-mini-code:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'openrouter/free', // Fallback safety net at the very end
];

// Curated high-performing free vision/multimodal models
export const CURATED_FREE_VISION_MODELS = [
  'minimax/minimax-m3:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'dots-studio/dots-3-note-preview:free',
  'thinkingmachines/inkling:free',
  'thinkingmachines/inkling-small:free',
  'meta-llama/llama-3.2-11b-vision-instruct:free',
  'qwen/qwen-2.5-vl-72b-instruct:free',
  'openrouter/free', // Fallback safety net
];

// Models to explicitly exclude from conversational chat due to poor coherence or specialized classifier nature
const EXCLUDED_CHAT_MODELS = [
  'nvidia/nemotron-3.5-content-safety:free', // Safety classification only
  'liquid/lfm-2.5-2.6b:free', // Sub-3B model incapable of complex persona instructions
];

export class ModelManager {
  private static instance: ModelManager;
  private freeTextModels: string[] = [];
  private freeVisionModels: string[] = [];
  private allFreeModelsData: OpenRouterModel[] = [];
  private lastFetchTime: number = 0;
  private refreshTimer: NodeJS.Timeout | null = null;

  // Sticky model tracking: keep the model consistent across turns
  private activeTextModel: string | null = null;
  private activeVisionModel: string | null = null;

  private constructor() {
    this.freeTextModels = [...CURATED_FREE_TEXT_MODELS];
    this.freeVisionModels = [...CURATED_FREE_VISION_MODELS];
  }

  public static getInstance(): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager();
    }
    return ModelManager.instance;
  }

  /**
   * Initializes model discovery and sets up recurring refresh
   */
  public async initialize(): Promise<void> {
    await this.refreshModels();

    const intervalMs = config.MODEL_FETCH_INTERVAL_HOURS * 60 * 60 * 1000;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      this.refreshModels().catch((err) => {
        console.error('[OPENROUTER] Scheduled model refresh failed:', err.message);
      });
    }, intervalMs);
    if (this.refreshTimer.unref) this.refreshTimer.unref();
  }

  /**
   * Fetches latest models from OpenRouter API and parses free models
   */
  public async refreshModels(): Promise<void> {
    try {
      console.log('[OPENROUTER] Fetching available models from OpenRouter API...');
      const response = await axios.get<OpenRouterModelsResponse>('https://openrouter.ai/api/v1/models', {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      if (!response.data || !Array.isArray(response.data.data)) {
        console.warn('[OPENROUTER] Unexpected response format from OpenRouter models API. Using cached/curated models.');
        return;
      }

      const models = response.data.data;
      const freeModels: OpenRouterModel[] = [];
      const textModels: string[] = [];
      const visionModels: string[] = [];

      for (const m of models) {
        // Skip explicitly excluded models
        if (EXCLUDED_CHAT_MODELS.includes(m.id)) {
          continue;
        }

        const isFreeById = m.id.endsWith(':free') || m.id === 'openrouter/free';
        const isFreeByPricing =
          m.pricing &&
          (m.pricing.prompt === '0' || m.pricing.prompt === '0.0') &&
          (m.pricing.completion === '0' || m.pricing.completion === '0.0');

        if (isFreeById || isFreeByPricing) {
          freeModels.push(m);

          const modality = (m.architecture?.modality || '').toLowerCase();
          const isVision =
            modality.includes('image') ||
            modality.includes('multimodal') ||
            m.id.toLowerCase().includes('vision') ||
            m.id.toLowerCase().includes('vl');

          if (isVision) {
            visionModels.push(m.id);
          }
          textModels.push(m.id);
        }
      }

      if (textModels.length > 0) {
        this.allFreeModelsData = freeModels;
        this.freeTextModels = this.sortAndPrioritizeModels(
          textModels,
          CURATED_FREE_TEXT_MODELS,
          config.DEFAULT_TEXT_MODEL
        );
        this.freeVisionModels = this.sortAndPrioritizeModels(
          visionModels.length > 0 ? visionModels : CURATED_FREE_VISION_MODELS,
          CURATED_FREE_VISION_MODELS,
          config.DEFAULT_VISION_MODEL
        );
        this.lastFetchTime = Date.now();

        console.log(`[OPENROUTER] Loaded ${this.freeTextModels.length} free text models and ${this.freeVisionModels.length} free vision models.`);
        console.log(`[OPENROUTER] Primary text model: [${this.getActiveTextModel()}] | Primary vision model: [${this.getActiveVisionModel()}]`);
      } else {
        console.warn('[OPENROUTER] No free models detected in API response. Retaining curated model list.');
      }
    } catch (error: any) {
      console.warn(`[OPENROUTER] Failed to fetch models: ${error.message}. Retaining curated list.`);
    }
  }

  /**
   * Sorts discovered models against curated preference order, keeping openrouter/free at the end
   */
  private sortAndPrioritizeModels(
    discovered: string[],
    curatedList: string[],
    configuredDefault?: string
  ): string[] {
    const discoveredSet = new Set(discovered);
    const result: string[] = [];

    // 1. If user explicitly configured a model in .env, put it first
    if (configuredDefault && configuredDefault.trim()) {
      const def = configuredDefault.trim();
      result.push(def);
    }

    // 2. Add curated models that exist in discovered list in priority order
    for (const model of curatedList) {
      if (model === 'openrouter/free') continue; // reserve for end
      if (discoveredSet.has(model) && !result.includes(model)) {
        result.push(model);
      }
    }

    // 3. Add any newly discovered models not in curated list
    for (const model of discovered) {
      if (model === 'openrouter/free') continue;
      if (!result.includes(model)) {
        result.push(model);
      }
    }

    // 4. Always place openrouter/free at the end as last resort fallback
    result.push('openrouter/free');

    return Array.from(new Set(result));
  }

  /**
   * Returns candidate text models with active sticky model at front
   */
  public getTextModels(): string[] {
    const baseList = this.freeTextModels.length > 0 ? this.freeTextModels : CURATED_FREE_TEXT_MODELS;
    if (this.activeTextModel && baseList.includes(this.activeTextModel)) {
      return [this.activeTextModel, ...baseList.filter((m) => m !== this.activeTextModel)];
    }
    return baseList;
  }

  /**
   * Returns candidate vision models with active sticky model at front
   */
  public getVisionModels(): string[] {
    const baseList = this.freeVisionModels.length > 0 ? this.freeVisionModels : CURATED_FREE_VISION_MODELS;
    if (this.activeVisionModel && baseList.includes(this.activeVisionModel)) {
      return [this.activeVisionModel, ...baseList.filter((m) => m !== this.activeVisionModel)];
    }
    return baseList;
  }

  /**
   * Get current sticky active text model
   */
  public getActiveTextModel(): string {
    if (this.activeTextModel) return this.activeTextModel;
    const models = this.getTextModels();
    return models[0] || 'minimax/minimax-m3:free';
  }

  /**
   * Lock onto a newly confirmed active text model
   */
  public setActiveTextModel(model: string): void {
    if (model && model !== this.activeTextModel) {
      console.log(`[OPENROUTER] Sticky text model updated: [${model}]`);
      this.activeTextModel = model;
    }
  }

  /**
   * Get current sticky active vision model
   */
  public getActiveVisionModel(): string {
    if (this.activeVisionModel) return this.activeVisionModel;
    const models = this.getVisionModels();
    return models[0] || 'minimax/minimax-m3:free';
  }

  /**
   * Lock onto a newly confirmed active vision model
   */
  public setActiveVisionModel(model: string): void {
    if (model && model !== this.activeVisionModel) {
      console.log(`[OPENROUTER] Sticky vision model updated: [${model}]`);
      this.activeVisionModel = model;
    }
  }

  /**
   * Stop recurring timer
   */
  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
