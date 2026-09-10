import axios from 'axios';
import {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIMessage,
  OpenAIResponseOptions,
  OpenAIResponseResult,
  OpenAIToolDefinition,
} from './types.js';
import { ChatMessage, ToolCall } from '../openrouter/types.js';
import { config } from '../config.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { OutputGuard } from '../security/outputGuard.js';

export class OpenAIClient {
  private static instance: OpenAIClient;
  private currentKeyIndex = 0;
  private discoveredModels: string[] = [];
  private lastDiscoveryTime = 0;
  private activeModel: string = config.DEFAULT_OPENAI_MODEL || 'gpt-4o-mini';

  private constructor() {}

  public static getInstance(): OpenAIClient {
    if (!OpenAIClient.instance) {
      OpenAIClient.instance = new OpenAIClient();
    }
    return OpenAIClient.instance;
  }

  public getActiveModel(): string {
    return this.activeModel;
  }

  public setActiveModel(model: string): void {
    if (model) {
      this.activeModel = model.trim();
      console.log(`[OPENAI] Active model switched to: [${this.activeModel}]`);
    }
  }

  public getAvailableModels(): string[] {
    const list = [...this.discoveredModels];
    const defaults = ['gpt-4o-mini', 'gpt-4o', 'deepseek-chat', 'deepseek-reasoner', 'llama-3.3-70b-versatile'];
    for (const d of defaults) {
      if (!list.includes(d)) list.push(d);
    }
    return list;
  }

  /**
   * Retrieves active API key and rotates when rate-limited
   */
  private getApiKey(): string {
    const keys = config.openaiApiKeys;
    if (!keys || keys.length === 0) {
      return '';
    }
    return keys[this.currentKeyIndex % keys.length];
  }

  private rotateApiKey(): void {
    const keys = config.openaiApiKeys;
    if (keys && keys.length > 1) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % keys.length;
      console.log(`[OPENAI] Rotated to next OpenAI API key (Index #${this.currentKeyIndex})`);
    }
  }

  /**
   * Gets normalized base API URL (e.g. "https://api.openai.com/v1" or "http://localhost:11434/v1")
   */
  public getBaseUrl(): string {
    const raw = config.OPENAI_API_BASE || 'https://api.openai.com/v1';
    return raw.replace(/\/+$/, '');
  }

  /**
   * Dynamically queries /models endpoint if supported by the provider
   */
  public async refreshModels(): Promise<string[]> {
    const now = Date.now();
    // Cache discovery for 30 minutes
    if (this.discoveredModels.length > 0 && now - this.lastDiscoveryTime < 30 * 60 * 1000) {
      return this.discoveredModels;
    }

    try {
      const apiKey = this.getApiKey();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await axios.get<{ data?: Array<{ id: string }> }>(
        `${this.getBaseUrl()}/models`,
        { headers, timeout: 8000 }
      );

      if (response.data && Array.isArray(response.data.data)) {
        const models = response.data.data.map((m) => m.id);
        if (models.length > 0) {
          this.discoveredModels = models;
          this.lastDiscoveryTime = now;
          console.log(
            `[OPENAI] Discovered ${models.length} models from endpoint: ${models.slice(0, 5).join(', ')}...`
          );
          return models;
        }
      }
    } catch (err: any) {
      console.warn(`[OPENAI] Model discovery skipped/failed (${err.message}). Using configured model.`);
    }

    return [];
  }

  /**
   * Generates a chat completion with multi-turn agentic tool calling and fallback retries
   */
  public async generateChatCompletion(options: OpenAIResponseOptions): Promise<OpenAIResponseResult> {
    const primaryModel = options.model || this.activeModel || config.DEFAULT_OPENAI_MODEL || 'gpt-4o-mini';
    const baseUrl = this.getBaseUrl();

    // Determine candidate models list
    const candidateModels: string[] = [primaryModel];
    // Add common fallback models if targeting official OpenAI
    if (baseUrl.includes('api.openai.com')) {
      const standardFallbacks = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];
      for (const m of standardFallbacks) {
        if (!candidateModels.includes(m)) {
          candidateModels.push(m);
        }
      }
    }

    let lastError: Error | null = null;
    let attempts = 0;
    const maxAttempts = Math.min(candidateModels.length + 2, 5);

    for (let i = 0; i < maxAttempts; i++) {
      const selectedModel = candidateModels[i % candidateModels.length];
      attempts++;

      try {
        const result = await this.executeAgenticCompletionLoop(selectedModel, options);
        return {
          content: result.content,
          usedModel: result.usedModel || selectedModel,
          retriesCount: attempts - 1,
        };
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        const errorData = error.response?.data?.error?.message || error.message;

        console.warn(
          `[WARN] OpenAI model [${selectedModel}] failed (status: ${status || 'network'}, reason: ${errorData}). Attempting retry/fallback...`
        );

        if (status === 429 || status === 401 || status === 402) {
          this.rotateApiKey();
        }

        await new Promise((res) => setTimeout(res, 1000));
      }
    }

    throw new Error(
      `OpenAI completion failed after ${attempts} attempts. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Runs the multi-turn Agentic Function Calling loop (up to 4 iterations)
   */
  private async executeAgenticCompletionLoop(
    model: string,
    options: OpenAIResponseOptions
  ): Promise<{ content: string; usedModel: string }> {
    const baseUrl = this.getBaseUrl();
    const endpoint = `${baseUrl}/chat/completions`;

    // Initialize messages list
    const currentMessages: OpenAIMessage[] = options.messages.map((m) => ({
      role: m.role,
      content: m.content,
      name: m.name,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
    }));

    const tools: OpenAIToolDefinition[] | undefined =
      config.ENABLE_WEB_SEARCH && !options.hasSearchContext
        ? (ToolRegistry.getToolDefinitions() as OpenAIToolDefinition[])
        : undefined;

    const MAX_TOOL_TURNS = 4;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const apiKey = this.getApiKey();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const payload: OpenAIChatRequest = {
        model,
        messages: currentMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        tools,
        tool_choice: tools ? 'auto' : undefined,
      };

      const response = await axios.post<OpenAIChatResponse>(endpoint, payload, {
        headers,
        timeout: 45000,
      });

      const choice = response.data.choices?.[0];
      if (!choice || !choice.message) {
        throw new Error('Empty response received from OpenAI-compatible provider.');
      }

      const message = choice.message;
      const rawContent = message.content ? String(message.content).trim() : '';

      // Check for structured tool calls or text-embedded tool calls
      let activeToolCalls: ToolCall[] = [];
      if (message.tool_calls && message.tool_calls.length > 0) {
        activeToolCalls = message.tool_calls;
      } else if (rawContent) {
        activeToolCalls = this.extractTextToolCalls(rawContent);
      }

      // If model requested tool calls, execute them and continue loop
      if (activeToolCalls.length > 0) {
        console.log(
          `[OPENAI_TOOL] Turn #${turn + 1}: Model requested ${activeToolCalls.length} tool call(s): ${activeToolCalls.map((t) => t.function.name).join(', ')}`
        );

        // Record assistant's tool-call request message
        currentMessages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: activeToolCalls,
        });

        // Execute each tool and append tool response message
        for (const toolCall of activeToolCalls) {
          const toolName = toolCall.function.name;
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs =
              typeof toolCall.function.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments || {};
          } catch {
            parsedArgs = {};
          }

          console.log(`[OPENAI_TOOL] Executing [${toolName}] with args:`, parsedArgs);
          const toolResult = await ToolRegistry.executeTool(toolName, parsedArgs);
          const contentOutput =
            typeof toolResult === 'string'
              ? toolResult
              : JSON.stringify(toolResult);

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: contentOutput,
          });
        }

        // Loop to next turn for model to process tool outputs
        continue;
      }

      // No tool calls requested: we have the final assistant reply
      const cleaned = this.cleanResidualToolTags(rawContent);
      const extracted = this.extractCleanAnswer(cleaned);

      if (!extracted.isComplete || !extracted.answer) {
        console.warn(`[OPENAI] Model produced an incomplete answer. Continuing or finalizing...`);
        return {
          content: cleaned || rawContent,
          usedModel: response.data.model || model,
        };
      }

      return {
        content: extracted.answer,
        usedModel: response.data.model || model,
      };
    }

    throw new Error(`Exceeded maximum tool execution turns (${MAX_TOOL_TURNS}).`);
  }

  /**
   * Extracts text-based tool calls (DSML, XML, or JSON blocks) emitted by models in raw text
   */
  private extractTextToolCalls(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // 1. DeepSeek / Qwen DSML format: < | DSML | invoke name="..."> ... </ | DSML | invoke>
    const dsmlInvokeRegex =
      /<[\s|]*DSML[\s|]*invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/[\s|]*DSML[\s|]*invoke>/gi;
    let match: RegExpExecArray | null;

    while ((match = dsmlInvokeRegex.exec(content)) !== null) {
      const toolName = match[1];
      const invokeBody = match[2];
      const params: Record<string, any> = {};

      const paramRegex =
        /<[\s|]*DSML[\s|]*parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[\s|]*DSML[\s|]*parameter>/gi;
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = paramRegex.exec(invokeBody)) !== null) {
        params[paramMatch[1]] = paramMatch[2].trim();
      }

      toolCalls.push({
        id: 'call_' + Math.random().toString(36).substring(2, 9),
        type: 'function',
        function: {
          name: toolName,
          arguments: JSON.stringify(params),
        },
      });
    }

    // 2. Standard XML: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
    if (toolCalls.length === 0) {
      const toolCallXmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
      while ((match = toolCallXmlRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (parsed.name) {
            toolCalls.push({
              id: 'call_' + Math.random().toString(36).substring(2, 9),
              type: 'function',
              function: {
                name: parsed.name,
                arguments:
                  typeof parsed.arguments === 'string'
                    ? parsed.arguments
                    : JSON.stringify(parsed.arguments || {}),
              },
            });
          }
        } catch {}
      }
    }

    return toolCalls;
  }

  /**
   * Strips unexecuted or residual DSML/XML tags from text
   */
  private cleanResidualToolTags(text: string): string {
    return text
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*tool_calls>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*invoke>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*.*?>/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .trim();
  }

  /**
   * Extracts clean character dialogue from thinking models and checklists
   */
  private extractCleanAnswer(content: string): { isComplete: boolean; answer: string } {
    let text = content;

    // Detect unclosed <think> tag
    const hasOpenThink = /<(think|thought|reasoning)>/i.test(text);
    const hasCloseThink = /<\/(think|thought|reasoning)>/i.test(text);

    if (hasOpenThink && !hasCloseThink) {
      return { isComplete: false, answer: '' };
    }

    // Strip thinking blocks
    text = text.replace(/<(think|thought|reasoning|reflection|analysis)>[\s\S]*?<\/\1>/gi, '').trim();

    // If Revised Response header exists, extract revised portion
    const revisionRegex =
      /(?:^|\n)\s*\*?\s*(?:Revised|Final)\s+(?:Response|Output|Answer|Version)\s*:?\*?\s*([\s\S]+)$/i;
    const revMatch = text.match(revisionRegex);
    if (revMatch && revMatch[1]) {
      text = revMatch[1].trim();
    }

    // Apply OutputGuard
    const sanitized = OutputGuard.getInstance().sanitize(text);

    return {
      isComplete: true,
      answer: sanitized,
    };
  }
}

