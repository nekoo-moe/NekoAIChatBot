import axios from 'axios';
import { ChatMessage, OpenRouterChatRequest, OpenRouterChatResponse, ToolCall } from './types.js';
import { ModelManager } from './modelManager.js';
import { config } from '../config.js';
import { ToolRegistry } from '../tools/toolRegistry.js';

export interface GenerateResponseOptions {
  messages: ChatMessage[];
  hasImages?: boolean;
  hasSearchContext?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResponseResult {
  content: string;
  usedModel: string;
  retriesCount: number;
}

export class OpenRouterClient {
  private static instance: OpenRouterClient;
  private currentKeyIndex = 0;
  private modelManager: ModelManager;

  private constructor() {
    this.modelManager = ModelManager.getInstance();
  }

  public static getInstance(): OpenRouterClient {
    if (!OpenRouterClient.instance) {
      OpenRouterClient.instance = new OpenRouterClient();
    }
    return OpenRouterClient.instance;
  }

  /**
   * Get the current active API key and optionally rotate to the next
   */
  private getApiKey(): string {
    const keys = config.openRouterApiKeys;
    if (!keys || keys.length === 0) {
      throw new Error('No OpenRouter API key found in configuration (OPENROUTER_API_KEYS).');
    }
    const key = keys[this.currentKeyIndex % keys.length];
    return key;
  }

  private rotateApiKey(): void {
    const keys = config.openRouterApiKeys;
    if (keys.length > 1) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % keys.length;
      console.log(`[OPENROUTER] Rotated to next API key (Index #${this.currentKeyIndex})`);
    }
  }

  /**
   * Generates a chat completion with automatic model fallback, key rotation, and tool execution
   */
  public async generateChatCompletion(options: GenerateResponseOptions): Promise<GenerateResponseResult> {
    const candidateModels = options.hasImages
      ? this.modelManager.getVisionModels()
      : this.modelManager.getTextModels();

    let lastError: Error | null = null;
    let attempts = 0;
    const maxAttempts = Math.min(candidateModels.length, 5);

    // Working copy of messages for potential tool calling loops
    let currentMessages = [...options.messages];
    // If search context is already injected, do NOT pass tools to avoid confusing free models
    const tools =
      config.ENABLE_WEB_SEARCH && !options.hasSearchContext
        ? ToolRegistry.getToolDefinitions()
        : undefined;

    for (let i = 0; i < maxAttempts; i++) {
      const selectedModel = candidateModels[i];
      const fallbackModels = candidateModels.slice(i + 1, i + 4);

      try {
        attempts++;
        const apiKey = this.getApiKey();

        const payload: OpenRouterChatRequest = {
          model: selectedModel,
          models: fallbackModels.length > 0 ? fallbackModels : undefined,
          messages: currentMessages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 1024,
          plugins: config.ENABLE_WEB_SEARCH
            ? [
                {
                  id: 'web',
                  max_results: 5,
                },
              ]
            : undefined,
          reasoning: {
            exclude: true,
          },
        };

        const response = await axios.post<OpenRouterChatResponse>(
          'https://openrouter.ai/api/v1/chat/completions',
          payload,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://github.com/nekoo-moe/NekoAIChatBot',
              'X-Title': 'NekoAI Discord Bot',
              'Content-Type': 'application/json',
            },
            timeout: 45000,
          }
        );

        const choice = response.data.choices?.[0];
        if (!choice) {
          throw new Error('Empty response choices received from OpenRouter API.');
        }

        const rawContent = choice.message.content?.trim() || '';

        // 1. Check for standard JSON tool calls
        let activeToolCalls: ToolCall[] = [];
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          activeToolCalls = choice.message.tool_calls;
        } else if (rawContent) {
          // 2. Check for text-based tool calls (like DeepSeek / Qwen DSML or XML tags)
          activeToolCalls = this.extractTextToolCalls(rawContent);
        }

        if (activeToolCalls.length > 0) {
          console.log(`[TOOL] Detected ${activeToolCalls.length} tool call(s) from model [${selectedModel}].`);
          const toolCallResult = await this.handleToolCalls(
            activeToolCalls,
            currentMessages,
            selectedModel,
            fallbackModels
          );
          if (toolCallResult) {
            return {
              content: this.cleanResidualToolTags(toolCallResult.content),
              usedModel: toolCallResult.usedModel || selectedModel,
              retriesCount: attempts - 1,
            };
          }
        }

        const cleanReply = this.cleanResidualToolTags(rawContent);
        if (!cleanReply) {
          throw new Error('Received empty text content from model response.');
        }

        return {
          content: cleanReply,
          usedModel: response.data.model || selectedModel,
          retriesCount: attempts - 1,
        };
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        const errorData = error.response?.data?.error?.message || error.message;

        console.warn(
          `[WARN] Model [${selectedModel}] failed (status: ${status || 'network'}, reason: ${errorData}). Attempting fallback...`
        );

        // If rate limit (429) or payment required (402), rotate API key if multiple exist
        if (status === 429 || status === 402) {
          this.rotateApiKey();
        }

        // Small delay before trying next model
        await new Promise((res) => setTimeout(res, 800));
      }
    }

    throw new Error(
      `All attempted free models failed after ${attempts} retries. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Extracts text-based tool calls (DSML, XML, or JSON blocks) emitted by models in raw text
   */
  private extractTextToolCalls(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // 1. DeepSeek / Qwen DSML format: < | DSML | invoke name="..."> ... </ | DSML | invoke>
    const dsmlInvokeRegex = /<[\s|]*DSML[\s|]*invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/[\s|]*DSML[\s|]*invoke>/gi;
    let match: RegExpExecArray | null;

    while ((match = dsmlInvokeRegex.exec(content)) !== null) {
      const toolName = match[1];
      const invokeBody = match[2];
      const params: Record<string, any> = {};

      const paramRegex = /<[\s|]*DSML[\s|]*parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[\s|]*DSML[\s|]*parameter>/gi;
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
        } catch {
          // ignore
        }
      }
    }

    return toolCalls;
  }

  /**
   * Executes tools requested by the model and feeds results back in universal format
   */
  private async handleToolCalls(
    toolCalls: ToolCall[],
    messages: ChatMessage[],
    model: string,
    fallbackModels: string[]
  ): Promise<{ content: string; usedModel: string } | null> {
    const updatedMessages = [...messages];
    const toolOutputs: string[] = [];

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        args = {};
      }

      console.log(`[TOOL] Executing tool [${toolName}] with arguments:`, args);
      const executionResult = await ToolRegistry.executeTool(toolName, args);
      toolOutputs.push(
        `[Search query: "${args.query || 'general'}"]\n${executionResult.formattedText || JSON.stringify(executionResult)}`
      );
    }

    // Append as a universal user message to guarantee compatibility with all free models
    updatedMessages.push({
      role: 'user',
      content: `[LIVE REAL-TIME INFORMATION RETRIEVED FROM WEB SEARCH]\n${toolOutputs.join(
        '\n\n'
      )}\n\nPlease now answer the user's question directly based on the facts above in character as NekoAI. Do NOT emit any DSML, XML or tool call markup tags. Speak directly as a cute girl.`,
    });

    // Call model again without tools parameter to force text answer
    try {
      const apiKey = this.getApiKey();
      const payload: OpenRouterChatRequest = {
        model,
        models: fallbackModels.length > 0 ? fallbackModels : undefined,
        messages: updatedMessages,
        temperature: 0.7,
        max_tokens: 1024,
      };

      const response = await axios.post<OpenRouterChatResponse>(
        'https://openrouter.ai/api/v1/chat/completions',
        payload,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://github.com/nekoo-moe/NekoAIChatBot',
            'X-Title': 'NekoAI Discord Bot',
            'Content-Type': 'application/json',
          },
          timeout: 40000,
        }
      );

      const choice = response.data.choices?.[0];
      if (choice && choice.message.content) {
        return {
          content: choice.message.content.trim(),
          usedModel: response.data.model || model,
        };
      }
    } catch (err: any) {
      console.warn('[WARN] Error getting final answer after tool call:', err.message);
    }

    return null;
  }

  /**
   * Strips any unexecuted or residual DSML/XML tags and thinking dumps
   */
  private cleanResidualToolTags(text: string): string {
    let cleaned = text
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*tool_calls>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*invoke>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*.*?>/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .trim();

    return this.stripThinkingProcess(cleaned);
  }

  /**
   * Strips out raw thinking process dumps ("Here's a thinking process:", <think>...</think>, etc.)
   */
  private stripThinkingProcess(text: string): string {
    let cleaned = text;

    // 1. Remove XML thinking tags (<think>, <thought>, <reasoning>, <reflection>)
    cleaned = cleaned.replace(/<(think|thought|reasoning|reflection)>[\s\S]*?<\/\1>/gi, '').trim();

    // 2. Remove thought preambles up to the first <|ACT token
    const thinkingUpToActRegex = /^(?:(?:\*\*|##|#)?\s*(?:Here'?s (?:a\s+)?|My\s+)?(?:thinking|thought|reasoning)(?:\s+process)?(?::|\*\*|##|#)?|Let's think step by step:?)[\s\S]*?(?=(<\|ACT\s+.*?\|>))/i;
    if (thinkingUpToActRegex.test(cleaned)) {
      cleaned = cleaned.replace(thinkingUpToActRegex, '').trim();
    }

    // 3. In case <|ACT is missing or wrapped under "Structure:" / "Response:" marker
    if (/^(?:(?:\*\*|##|#)?\s*(?:Here'?s (?:a\s+)?|My\s+)?(?:thinking|thought|reasoning)(?:\s+process)?(?::|\*\*|##|#)?|Let's think step by step:?)/i.test(cleaned)) {
      const match = cleaned.match(/(?:Structure|Final response|Response|Output):\s*([\s\S]+)$/i);
      if (match && match[1]) {
        cleaned = match[1].trim();
      }
    }

    // 4. Remove residual meta labels like "Structure:", "Then body:", "Let's craft the response:"
    cleaned = cleaned.replace(/^(?:Structure|Then body|Body|Response|Final response|Output):\s*/gim, '').trim();

    return cleaned;
  }
}
