import axios from 'axios';
import { OpenRouterModel, OpenRouterModelsResponse } from './types.js';
import { config } from '../config.js';

// Reliable hardcoded fallback free models in case API is momentarily unreachable
const FALLBACK_FREE_TEXT_MODELS = [
  'openrouter/free',
  'inclusionai/ling-3.0-flash-sante:free',
  'inclusionai/ling-3.0-flash-fin:free',
  'liquid/lfm-2.5-2.6b:free',
  'nvidia/nemotron-3.5-lightning:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
];

const FALLBACK_FREE_VISION_MODELS = [
  'openrouter/free',
  'minimax/minimax-m3:free',
  'dots-studio/dots-3-note-preview:free',
  'thinkingmachines/inkling:free',
  'meta-llama/llama-3.2-11b-vision-instruct:free',
  'qwen/qwen-2.5-vl-72b-instruct:free',
];

export class ModelManager {
  private static instance: ModelManager;
  private freeTextModels: string[] = [];
  private freeVisionModels: string[] = [];
  private allFreeModelsData: OpenRouterModel[] = [];
  private lastFetchTime: number = 0;
  private refreshTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.freeTextModels = [...FALLBACK_FREE_TEXT_MODELS];
    this.freeVisionModels = [...FALLBACK_FREE_VISION_MODELS];
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
        console.warn('[OPENROUTER] Unexpected response format from OpenRouter models API. Using cached/fallback models.');
        return;
      }

      const models = response.data.data;
      const freeModels: OpenRouterModel[] = [];
      const textModels: string[] = [];
      const visionModels: string[] = [];

      for (const m of models) {
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
        this.freeTextModels = this.prioritizeModels(textModels, config.DEFAULT_TEXT_MODEL);
        this.freeVisionModels = this.prioritizeModels(
          visionModels.length > 0 ? visionModels : FALLBACK_FREE_VISION_MODELS,
          config.DEFAULT_VISION_MODEL
        );
        this.lastFetchTime = Date.now();

        console.log(`[OPENROUTER] Loaded ${this.freeTextModels.length} free text models and ${this.freeVisionModels.length} free vision models.`);
      } else {
        console.warn('[OPENROUTER] No free models detected in API response. Retaining fallback model list.');
      }
    } catch (error: any) {
      console.warn(`[OPENROUTER] Failed to fetch models: ${error.message}. Retaining fallbacks.`);
    }
  }

  /**
   * Helper to ensure configured default model comes first if specified
   */
  private prioritizeModels(list: string[], preferredModel?: string): string[] {
    const unique = Array.from(new Set(list));
    if (preferredModel && preferredModel.trim()) {
      const target = preferredModel.trim();
      const filtered = unique.filter((id) => id !== target);
      return [target, ...filtered];
    }
    const withoutRouter = unique.filter((id) => id !== 'openrouter/free');
    return ['openrouter/free', ...withoutRouter];
  }

  /**
   * Get candidate models list for text queries
   */
  public getTextModels(): string[] {
    return this.freeTextModels.length > 0 ? this.freeTextModels : FALLBACK_FREE_TEXT_MODELS;
  }

  /**
   * Get candidate models list for multimodal (image) queries
   */
  public getVisionModels(): string[] {
    return this.freeVisionModels.length > 0 ? this.freeVisionModels : FALLBACK_FREE_VISION_MODELS;
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
