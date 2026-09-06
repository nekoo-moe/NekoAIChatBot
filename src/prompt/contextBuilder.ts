import { getNekoSystemPrompt } from './systemPrompt.js';
import { ChatMessage, ContentPart } from '../openrouter/types.js';

export interface BuildContextOptions {
  history: Array<{
    role: 'user' | 'assistant';
    authorName?: string;
    content: string;
    imageUrls?: string[];
  }>;
  currentMessage: {
    authorName: string;
    content: string;
    imageUrls?: string[];
  };
  searchContext?: string;
}

export function buildConversationContext(options: BuildContextOptions): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // 1. Dynamic System Prompt with Current Date & Year
  messages.push({
    role: 'system',
    content: getNekoSystemPrompt(),
  });

  // 2. Add real-time web search context if present
  if (options.searchContext) {
    messages.push({
      role: 'system',
      content: `[REAL-TIME LIVE INFORMATION RETRIEVED FROM WEB SEARCH]\n${options.searchContext}\n(Use the above facts to inform your response while remaining in character as NekoAI.)`,
    });
  }

  // 3. Conversation history (recent messages for context continuity)
  for (const item of options.history) {
    if (item.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: item.content,
      });
    } else {
      // User message in history
      const formattedText = `<user_history author="${escapeXml(item.authorName || 'User')}">\n${item.content}\n</user_history>`;

      if (item.imageUrls && item.imageUrls.length > 0) {
        const parts: ContentPart[] = [{ type: 'text', text: formattedText }];
        for (const url of item.imageUrls) {
          parts.push({ type: 'image_url', image_url: { url } });
        }
        messages.push({ role: 'user', content: parts });
      } else {
        messages.push({ role: 'user', content: formattedText });
      }
    }
  }

  // 4. Current user message (isolated with strict delimiter tags)
  const currentFormattedText = `<user_input author="${escapeXml(options.currentMessage.authorName)}">\n${options.currentMessage.content}\n</user_input>`;

  if (options.currentMessage.imageUrls && options.currentMessage.imageUrls.length > 0) {
    const parts: ContentPart[] = [{ type: 'text', text: currentFormattedText }];
    for (const url of options.currentMessage.imageUrls) {
      parts.push({ type: 'image_url', image_url: { url } });
    }
    messages.push({ role: 'user', content: parts });
  } else {
    messages.push({ role: 'user', content: currentFormattedText });
  }

  return messages;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

