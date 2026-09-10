import { ChatMessage, ContentPart, ToolCall } from '../openrouter/types.js';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: OpenAIToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required';
  stream?: boolean;
}

export interface OpenAIChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: string;
}

export interface OpenAIChatResponse {
  id: string;
  object?: string;
  created?: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIResponseOptions {
  messages: ChatMessage[];
  hasImages?: boolean;
  hasSearchContext?: boolean;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface OpenAIResponseResult {
  content: string;
  usedModel: string;
  retriesCount: number;
}

