export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string; // http(s) URL or data:image/png;base64,...
  };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface OpenRouterModelPricing {
  prompt: string;
  completion: string;
  image?: string;
  request?: string;
}

export interface OpenRouterModelArchitecture {
  modality?: string; // e.g. "text->text" or "text+image->text"
  instruct_type?: string | null;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: OpenRouterModelPricing;
  architecture?: OpenRouterModelArchitecture;
  top_provider?: {
    is_moderated?: boolean;
    max_completion_tokens?: number | null;
  };
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export interface OpenRouterChatRequest {
  model: string;
  messages: ChatMessage[];
  models?: string[]; // Fallback list
  temperature?: number;
  max_tokens?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  plugins?: Array<{
    id: string;
    max_results?: number;
    engine?: string;
    search_prompt?: string;
  }>;
  reasoning?: {
    effort?: string;
    max_tokens?: number;
    exclude?: boolean;
  };
}

export interface OpenRouterChatChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: string;
}

export interface OpenRouterChatResponse {
  id: string;
  choices: OpenRouterChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

