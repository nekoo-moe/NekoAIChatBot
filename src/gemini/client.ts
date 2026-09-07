import axios from 'axios';
import { GeminiRequest, GeminiResponse, GeminiContent, GeminiPart } from './types.js';
import { ChatMessage, ContentPart } from '../openrouter/types.js';
import { config } from '../config.js';
import { OutputGuard } from '../security/outputGuard.js';

export interface GeminiResponseOptions {
  messages: ChatMessage[];
  hasImages?: boolean;
  hasSearchContext?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface GeminiResponseResult {
  content: string;
  usedModel: string;
  retriesCount: number;
}

// Modern fallback models list (Gemini 3.6 & Gemma 4)
const FALLBACK_GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
  'gemma-3-27b-it',
  'gemma-2-27b-it',
  'gemma-2-9b-it',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

export class GeminiClient {
  private static instance: GeminiClient;
  private currentKeyIndex = 0;
  private activeModel: string = 'gemini-3.6-flash';
  private discoveredModels: string[] = [];
  private lastDiscoveryTime: number = 0;

  private constructor() {
    this.activeModel = config.DEFAULT_GEMINI_MODEL || 'gemini-3.6-flash';
  }

  public static getInstance(): GeminiClient {
    if (!GeminiClient.instance) {
      GeminiClient.instance = new GeminiClient();
    }
    return GeminiClient.instance;
  }

  private getApiKey(): string {
    const keys = config.geminiApiKeys;
    if (!keys || keys.length === 0) {
      throw new Error('No Gemini API key found in configuration (GEMINI_API_KEYS).');
    }
    return keys[this.currentKeyIndex % keys.length];
  }

  private rotateApiKey(): void {
    const keys = config.geminiApiKeys;
    if (keys && keys.length > 1) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % keys.length;
      console.log(`[GEMINI] Rotated to next Gemini API key (Index #${this.currentKeyIndex})`);
    }
  }

  /**
   * Queries Google Gemini API /models endpoint to discover all active models supporting generateContent
   */
  public async refreshModels(): Promise<string[]> {
    try {
      const apiKey = this.getApiKey();
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const response = await axios.get<{
        models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
      }>(url, { timeout: 10000 });

      if (response.data && Array.isArray(response.data.models)) {
        const validModels = response.data.models
          .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m) => m.name.replace(/^models\//, ''));

        if (validModels.length > 0) {
          this.discoveredModels = validModels;
          this.lastDiscoveryTime = Date.now();
          console.log(
            `[GEMINI] Discovered ${validModels.length} active models from Gemini API: ${validModels.slice(0, 6).join(', ')}...`
          );
          return validModels;
        }
      }
    } catch (err: any) {
      console.warn(`[GEMINI] Dynamic model discovery failed: ${err.message}. Using modern fallback list.`);
    }
    return [];
  }

  /**
   * Generates a chat completion using Google Gemini API with automatic model discovery, fallback, and key rotation
   */
  public async generateChatCompletion(options: GeminiResponseOptions): Promise<GeminiResponseResult> {
    // Refresh model catalog if not yet discovered or older than 2 hours
    if (this.discoveredModels.length === 0 || Date.now() - this.lastDiscoveryTime > 2 * 60 * 60 * 1000) {
      await this.refreshModels().catch(() => {});
    }

    const candidateModels = this.getModelCandidates();
    let lastError: Error | null = null;
    let attempts = 0;

    for (const rawModel of candidateModels) {
      const model = rawModel.replace(/^models\//, '');
      const isGemma = model.toLowerCase().includes('gemma');

      try {
        attempts++;
        const apiKey = this.getApiKey();

        // 1. Transform ChatMessage[] into Gemini format
        const { systemInstruction, contents } = await this.transformMessages(options.messages);

        // 2. Build Gemini Request Payload
        const payload: GeminiRequest = {
          contents,
          generationConfig: {
            temperature: options.temperature ?? 0.7,
            maxOutputTokens: options.maxTokens ?? 4096,
          },
        };

        if (systemInstruction) {
          payload.systemInstruction = systemInstruction;
        }

        // Enable Google Search Grounding for Gemini models if configured
        // (Gemma open-weight models do not support the googleSearch tool parameter)
        if (config.ENABLE_WEB_SEARCH && !options.hasSearchContext && !isGemma) {
          payload.tools = [{ googleSearch: {} }];
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        let response;
        try {
          response = await axios.post<GeminiResponse>(url, payload, {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 45000,
          });
        } catch (postError: any) {
          // If error was 400 due to tool unsupported, retry once without tools
          const status = postError.response?.status;
          const msg = postError.response?.data?.error?.message || '';
          if (status === 400 && payload.tools && (msg.includes('tool') || msg.includes('search') || msg.includes('googleSearch'))) {
            console.warn(`[GEMINI] Model [${model}] does not support search tool. Retrying without tools...`);
            delete payload.tools;
            response = await axios.post<GeminiResponse>(url, payload, {
              headers: { 'Content-Type': 'application/json' },
              timeout: 45000,
            });
          } else {
            throw postError;
          }
        }

        const candidate = response.data.candidates?.[0];
        if (!candidate || !candidate.content || !candidate.content.parts) {
          throw new Error('Empty response candidate received from Gemini API.');
        }

        const rawText = candidate.content.parts
          .map((p) => p.text || '')
          .filter(Boolean)
          .join('\n')
          .trim();

        if (!rawText) {
          throw new Error('No text returned in Gemini response parts.');
        }

        // Check if web search grounding was triggered
        if (candidate.groundingMetadata?.webSearchQueries?.length) {
          console.log(
            `[GEMINI SEARCH] Model [${model}] grounded query via Google Search: ${candidate.groundingMetadata.webSearchQueries.join(', ')}`
          );
        }

        // Clean thinking trace if model produced any reasoning notes
        const cleanedText = this.cleanThinkingTrace(rawText);

        // Lock onto this working model as sticky active model
        this.activeModel = model;

        return {
          content: cleanedText,
          usedModel: model,
          retriesCount: attempts - 1,
        };
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        const errorMsg = error.response?.data?.error?.message || error.message;

        console.warn(`[WARN] Gemini model [${model}] failed (status: ${status || 'network'}, reason: ${errorMsg}). Attempting fallback...`);

        // If rate limit (429) or resource exhausted, rotate key
        if (status === 429 || errorMsg?.includes('RESOURCE_EXHAUSTED')) {
          this.rotateApiKey();
        }

        // Delay briefly before trying fallback
        await new Promise((res) => setTimeout(res, 600));
      }
    }

    throw new Error(
      `All attempted Gemini models failed after ${attempts} retries. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Converts standard ChatMessage format to Gemini systemInstruction and contents
   */
  private async transformMessages(messages: ChatMessage[]): Promise<{
    systemInstruction?: { parts: Array<{ text: string }> };
    contents: GeminiContent[];
  }> {
    const systemParts: string[] = [];
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          systemParts.push(msg.content);
        }
        continue;
      }

      const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
      const parts: GeminiPart[] = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'text') {
            parts.push({ text: item.text });
          } else if (item.type === 'image_url' && item.image_url?.url) {
            const imagePart = await this.fetchImageInlineData(item.image_url.url);
            if (imagePart) {
              parts.push(imagePart);
            }
          }
        }
      }

      if (parts.length > 0) {
        const prevContent = contents[contents.length - 1];
        if (prevContent && prevContent.role === role) {
          prevContent.parts.push(...parts);
        } else {
          contents.push({ role, parts });
        }
      }
    }

    const systemInstruction =
      systemParts.length > 0
        ? { parts: [{ text: systemParts.join('\n\n') }] }
        : undefined;

    return { systemInstruction, contents };
  }

  /**
   * Helper to fetch an image attachment and convert it to Base64 inline data for Gemini
   */
  private async fetchImageInlineData(url: string): Promise<GeminiPart | null> {
    try {
      if (url.startsWith('data:')) {
        const matches = url.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          return {
            inlineData: {
              mimeType: matches[1],
              data: matches[2],
            },
          };
        }
      }

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });

      const headerMime = response.headers['content-type'];
      const mimeType = typeof headerMime === 'string' ? headerMime : 'image/jpeg';
      const base64Data = Buffer.from(response.data).toString('base64');

      return {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      };
    } catch (err: any) {
      console.warn(`[GEMINI] Failed to fetch image attachment from ${url}: ${err.message}`);
      return null;
    }
  }

  /**
   * Cleans residual thinking trace, checklists, or reasoning tags from model responses
   */
  private cleanThinkingTrace(text: string): string {
    return OutputGuard.getInstance().sanitize(text);
  }

  /**
   * Prioritizes active model, Gemma 4, Gemini 3.6, Gemma 3, and all available models
   */
  private getModelCandidates(): string[] {
    const list: string[] = [];

    // 1. User configured or sticky active model first
    if (this.activeModel) {
      list.push(this.activeModel);
    }
    if (config.DEFAULT_GEMINI_MODEL && !list.includes(config.DEFAULT_GEMINI_MODEL)) {
      list.push(config.DEFAULT_GEMINI_MODEL);
    }

    // 2. Discovered models sorted by priority
    if (this.discoveredModels.length > 0) {
      // Prioritize Gemma 4
      const gemma4 = this.discoveredModels.filter((m) => m.toLowerCase().includes('gemma-4'));
      list.push(...gemma4);

      // Prioritize Gemini 3.6 / Gemini 3
      const gemini3 = this.discoveredModels.filter((m) => m.toLowerCase().includes('gemini-3'));
      list.push(...gemini3);

      // Other Gemma models
      const otherGemma = this.discoveredModels.filter((m) => m.toLowerCase().includes('gemma') && !m.toLowerCase().includes('gemma-4'));
      list.push(...otherGemma);

      // Other Gemini models
      const otherGemini = this.discoveredModels.filter((m) => m.toLowerCase().includes('gemini') && !m.toLowerCase().includes('gemini-3'));
      list.push(...otherGemini);

      // Remaining discovered
      for (const m of this.discoveredModels) {
        if (!list.includes(m)) list.push(m);
      }
    }

    // 3. Append modern fallbacks
    for (const m of FALLBACK_GEMINI_MODELS) {
      if (!list.includes(m)) list.push(m);
    }

    return Array.from(new Set(list));
  }
}
