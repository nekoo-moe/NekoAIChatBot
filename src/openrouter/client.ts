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
    const maxAttempts = Math.min(candidateModels.length, 7);

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
          max_tokens: options.maxTokens ?? 4096,
          plugins: config.ENABLE_WEB_SEARCH
            ? [
                {
                  id: 'web',
                  max_results: 5,
                },
              ]
            : undefined,
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

        // Check if separate reasoning field was provided by OpenRouter
        const separateReasoning = (choice.message as any).reasoning;
        if (separateReasoning) {
          console.log(`[OPENROUTER] Model [${selectedModel}] provided internal reasoning (${separateReasoning.length} chars)`);
        }

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
            const cleaned = this.cleanResidualToolTags(toolCallResult.content);
            const extracted = this.extractCleanAnswer(cleaned);
            if (extracted.isComplete && extracted.answer) {
              const finalUsedModel = toolCallResult.usedModel || selectedModel;
              if (options.hasImages) {
                this.modelManager.setActiveVisionModel(selectedModel);
              } else {
                this.modelManager.setActiveTextModel(selectedModel);
              }
              return {
                content: extracted.answer,
                usedModel: finalUsedModel,
                retriesCount: attempts - 1,
              };
            }
          }
        }

        const cleanedContent = this.cleanResidualToolTags(rawContent);
        const extraction = this.extractCleanAnswer(cleanedContent);

        if (!extraction.isComplete || !extraction.answer) {
          console.warn(
            `[WARN] Model [${selectedModel}] produced an incomplete thinking trace without a final answer (finish_reason: ${choice.finish_reason}). Failing over to next model...`
          );
          continue;
        }

        const finalUsedModel = response.data.model || selectedModel;
        if (options.hasImages) {
          this.modelManager.setActiveVisionModel(selectedModel);
        } else {
          this.modelManager.setActiveTextModel(selectedModel);
        }

        return {
          content: extraction.answer,
          usedModel: finalUsedModel,
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
        max_tokens: 4096,
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
   * Strips any unexecuted or residual DSML/XML tags from text
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
   * Extracts clean conversational answer from model output,
   * isolating thinking/reasoning and verifying that full dialogue was produced
   */
  public extractCleanAnswer(rawContent: string): { answer: string; isComplete: boolean } {
    let text = (rawContent || '').trim();

    // 1. Remove XML thinking tags (<think>, <thought>, <reasoning>, <reflection>, <analysis>)
    text = text.replace(/<(think|thought|reasoning|reflection|analysis)>[\s\S]*?<\/\1>/gi, '').trim();

    // 2. Look for character ACT token anchor
    const actIndex = text.search(/<\|ACT\s+.*?\|>/i);
    if (actIndex !== -1) {
      const responsePart = text.substring(actIndex).trim();
      if (responsePart.length > 0) {
        return { answer: responsePart, isComplete: true };
      }
    }

    // 3. Response boundary markers ("Final response:", "Response:", "Output:", "Structure:", "Let's craft the response:")
    const responseHeaderRegex = /(?:^|\n)(?:(?:Final\s+)?(?:Response|Output|Answer)|Draft|Structure|Let's craft the response:?)\s*:\s*([\s\S]+)$/i;
    const headerMatch = text.match(responseHeaderRegex);
    if (headerMatch && headerMatch[1]) {
      const candidate = headerMatch[1].trim().replace(/^(?:Structure|Then body|Body|Output):\s*/gim, '').trim();
      if (candidate.length > 0) {
        return { answer: candidate, isComplete: true };
      }
    }

    // 4. Check if text is purely thinking/planning notes that never reached the response
    const isPureThinking = /^(?:(?:\*\*|##|#)?\s*(?:Here'?s (?:a\s+)?|My\s+)?(?:thinking|thought|reasoning)(?:\s+process)?(?::|\*\*|##|#)?|1\.\s+Analyze User Input)/i.test(text);
    if (isPureThinking) {
      return { answer: '', isComplete: false };
    }

    // 5. Remove residual meta labels if present
    text = text.replace(/^(?:Structure|Then body|Body|Response|Final response|Output):\s*/gim, '').trim();

    return { answer: text, isComplete: text.length > 0 };
  }
}
