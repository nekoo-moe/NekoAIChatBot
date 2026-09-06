import { Message, Client, ChannelType } from 'discord.js';
import { RateLimiter } from '../../security/rateLimiter.js';
import { InjectionDetector } from '../../security/injectionDetector.js';
import { OutputGuard } from '../../security/outputGuard.js';
import { OpenRouterClient } from '../../openrouter/client.js';
import { buildConversationContext } from '../../prompt/contextBuilder.js';
import { ToolRegistry } from '../../tools/toolRegistry.js';
import { SearchRouter } from '../../tools/search/searchRouter.js';
import { chunkMessage } from '../utils/chunker.js';
import { ActParser } from '../utils/actParser.js';

export async function handleMessage(message: Message, client: Client): Promise<void> {
  // Ignore messages from other bots or itself
  if (message.author.bot || !client.user) return;

  const botId = client.user.id;
  const isMentioned = message.mentions.has(botId);
  const isDM = message.channel.type === ChannelType.DM;

  // Check if replying to the bot
  let isReplyToBot = false;
  let referencedMessage: Message | null = null;

  if (message.reference && message.reference.messageId) {
    try {
      referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (referencedMessage && referencedMessage.author.id === botId) {
        isReplyToBot = true;
      }
    } catch {
      // Could not fetch referenced message (deleted or inaccessible)
    }
  }

  // Trigger only on mention, reply to bot, or DM
  if (!isMentioned && !isReplyToBot && !isDM) {
    return;
  }

  // Clean prompt content (remove bot mention tags)
  const mentionRegex = new RegExp(`<@!?${botId}>`, 'g');
  const cleanContent = message.content.replace(mentionRegex, '').trim();

  // Extract images from attachments
  const imageUrls: string[] = [];
  message.attachments.forEach((att) => {
    const isImage =
      (att.contentType && att.contentType.startsWith('image/')) ||
      /\.(png|jpe?g|webp|gif)$/i.test(att.name || '');

    if (isImage && att.url) {
      imageUrls.push(att.url);
    }
  });

  // If user provided neither text nor images, ignore
  if (!cleanContent && imageUrls.length === 0) {
    return;
  }

  // 1. Rate Limit Verification
  const rateLimiter = RateLimiter.getInstance();
  const rateCheck = rateLimiter.checkLimit(message.author.id, message.channel.id);
  if (!rateCheck.allowed) {
    const cooldownMsg = rateLimiter.getCooldownMessage(
      rateCheck.retryAfterSeconds || 10,
      rateCheck.reason || 'user'
    );
    await message.reply(ActParser.format(cooldownMsg));
    return;
  }

  // 2. Prompt Injection & Jailbreak Defense
  const injectionDetector = InjectionDetector.getInstance();
  const injectionCheck = injectionDetector.analyze(cleanContent);
  if (injectionCheck.isInjected && injectionCheck.refusalResponse) {
    console.warn(`[SECURITY] Prompt injection blocked from User [${message.author.tag}]: ${injectionCheck.matchedPattern}`);
    await message.reply(ActParser.format(injectionCheck.refusalResponse));
    return;
  }

  // 3. Start Typing Indicator
  const channel = message.channel;
  const canSendTyping = 'sendTyping' in channel && typeof channel.sendTyping === 'function';
  const typingInterval = canSendTyping
    ? setInterval(() => {
        (channel as any).sendTyping().catch(() => {});
      }, 4000)
    : null;

  if (canSendTyping) {
    await (channel as any).sendTyping().catch(() => {});
  }

  try {
    // 4. Build Context History (Up to 4 previous turns if reply chain exists)
    const history: Array<{
      role: 'user' | 'assistant';
      authorName?: string;
      content: string;
      imageUrls?: string[];
    }> = [];

    if (referencedMessage) {
      await fetchReplyChain(referencedMessage, history, botId, 4);
    }

    // 5. Build Conversation Payload
    const messages = buildConversationContext({
      history,
      currentMessage: {
        authorName: message.author.displayName || message.author.username,
        content: injectionCheck.sanitizedText || cleanContent,
        imageUrls,
      },
    });

    // 6. Request Completion from OpenRouter with Web Grounding Plugin and Auto-Rotation
    const openRouter = OpenRouterClient.getInstance();
    const result = await openRouter.generateChatCompletion({
      messages,
      hasImages: imageUrls.length > 0,
    });

    // 8. Output Guard: Sanitize and prevent leaks
    const outputGuard = OutputGuard.getInstance();
    const sanitizedReply = outputGuard.sanitize(result.content);

    // 9. Format ACT Tokens for Discord
    const formattedReply = ActParser.format(sanitizedReply);

    // 10. Split and send chunks safely
    const chunks = chunkMessage(formattedReply, 1950);

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await message.reply({
          content: chunks[i],
          allowedMentions: { repliedUser: false }, // Avoid annoying user ping
        });
      } else {
        if ('send' in channel && typeof channel.send === 'function') {
          await (channel as any).send(chunks[i]);
        }
      }
    }
  } catch (error: any) {
    console.error('[ERROR] Error handling message:', error);
    const errorNotice = ActParser.format(
      `<|ACT {"emotion":"sad"}|> Waah... My life pod server had a little hiccup! (${error.message || 'Unknown issue'}). Could you ask me again in a second, please? <|ACT {"emotion":"awkward"}|>`
    );
    await message.reply({
      content: errorNotice,
      allowedMentions: { repliedUser: false },
    });
  } finally {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

/**
 * Recursively fetches parent messages in a reply chain to reconstruct conversation context
 */
async function fetchReplyChain(
  msg: Message,
  history: Array<{
    role: 'user' | 'assistant';
    authorName?: string;
    content: string;
    imageUrls?: string[];
  }>,
  botId: string,
  depthRemaining: number
): Promise<void> {
  if (depthRemaining <= 0) return;

  // If this message was itself a reply, fetch parent first
  if (msg.reference && msg.reference.messageId) {
    try {
      const parentMsg = await msg.channel.messages.fetch(msg.reference.messageId);
      if (parentMsg) {
        await fetchReplyChain(parentMsg, history, botId, depthRemaining - 1);
      }
    } catch {
      // Parent message inaccessible
    }
  }

  // Push this message to history
  const isBot = msg.author.id === botId;
  const imageUrls: string[] = [];
  msg.attachments.forEach((att) => {
    if (att.contentType?.startsWith('image/') && att.url) {
      imageUrls.push(att.url);
    }
  });

  history.push({
    role: isBot ? 'assistant' : 'user',
    authorName: isBot ? 'NekoAI' : msg.author.displayName || msg.author.username,
    content: msg.cleanContent || msg.content,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
  });
}
