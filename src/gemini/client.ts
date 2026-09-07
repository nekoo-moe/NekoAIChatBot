import axios from 'axios';
import { GeminiRequest, GeminiResponse, GeminiContent, GeminiPart } from './types.js';
import { ChatMessage, ContentPart } from '../openrouter/types.js';
import { config } from '../config.js';

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

const FALLBACK_GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite-preview-02-05',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

export class GeminiClient {
  private static instance: GeminiClient;
  private currentKeyIndex = 0;
  private activeModel: string = 'gemini-2.0-flash';

  private constructor() {
    this.activeModel = config.DEFAULT_GEMINI_MODEL || 'gemini-2.0-flash';
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
   * Generates a chat completion using Google Gemini API with automatic model fallback and key rotation
   */
  public async generateChatCompletion(options: GeminiResponseOptions): Promise<GeminiResponseResult> {
    const candidateModels = this.getModelCandidates();
    let lastError: Error | null = null;
    let attempts = 0;

    for (const model of candidateModels) {
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

        // Enable Google Search Grounding if configured and no search context already supplied
        if (config.ENABLE_WEB_SEARCH && !options.hasSearchContext) {
          payload.tools = [{ googleSearch: {} }];
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await axios.post<GeminiResponse>(url, payload, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        });

        const candidate = response.data.candidates?.[0];
        if (!candidate || !candidate.content || !candidate.content.parts) {
          throw new Error('Empty response candidate received from Gemini API.');
        }

        let rawText = candidate.content.parts
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

        // Lock onto this working model
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
        await new Promise((res) => setTimeout(res, 800));
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
        // Gemini requires alternating roles or merges consecutive same-role messages
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
      // If already data URI
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
   * Cleans residual thinking process or reasoning tags from model responses
   */
  private cleanThinkingTrace(text: string): string {
    let cleaned = text.replace(/<(think|thought|reasoning|reflection|analysis)>[\s\S]*?<\/\1>/gi, '').trim();
    const actIndex = cleaned.search(/<\|ACT\s+.*?\|>/i);
    if (actIndex !== -1) {
      cleaned = cleaned.substring(actIndex).trim();
    } else {
      const responseHeaderRegex = /(?:^|\n)(?:(?:Final\s+)?(?:Response|Output|Answer)|Draft|Structure|Let's craft the response:?)\s*:\s*([\s\S]+)$/i;
      const headerMatch = cleaned.match(responseHeaderRegex);
      if (headerMatch && headerMatch[1]) {
        cleaned = headerMatch[1].trim();
      }
    }
    return cleaned.replace(/^(?:Structure|Then body|Body|Response|Final response|Output):\s*/gim, '').trim();
  }

  /**
   * Returns candidate model list with sticky active model at the front
   */
  private getModelCandidates(): string[] {
    const list = [
      this.activeModel,
      ...FALLBACK_GEMINI_MODELS.filter((m) => m !== this.activeModel),
    ];
    return Array.from(new Set(list));
  }
}
