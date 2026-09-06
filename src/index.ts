import { config } from './config.js';
import { ModelManager } from './openrouter/modelManager.js';
import { createDiscordClient, startBot } from './bot/client.js';

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('[SYSTEM] Starting NekoAI Discord Bot (TypeScript Engine)');
  console.log('----------------------------------------------------');

  // Verify essential config
  if (!config.DISCORD_BOT_TOKEN) {
    console.error('[CONFIG] Missing DISCORD_BOT_TOKEN in .env! Please set it before running the bot.');
    process.exit(1);
  }

  if (!config.OPENROUTER_API_KEYS || config.openRouterApiKeys.length === 0) {
    console.error('[CONFIG] Missing OPENROUTER_API_KEYS in .env! Please configure at least one key.');
    process.exit(1);
  }

  console.log(`[CONFIG] Loaded ${config.openRouterApiKeys.length} OpenRouter API key(s) for rotation.`);
  console.log(`[SECURITY] Prompt injection defense level: [${config.INJECTION_DEFENSE_LEVEL.toUpperCase()}]`);
  console.log(`[SEARCH] Real-time web search: [${config.ENABLE_WEB_SEARCH ? 'ENABLED' : 'DISABLED'}]`);
  console.log(`[FORMATTER] Emotion ACT tokens mode: [${config.PARSE_ACT_TOKENS.toUpperCase()}]`);

  // 1. Initialize OpenRouter dynamic model discovery & rotation
  const modelManager = ModelManager.getInstance();
  await modelManager.initialize();

  // 2. Start Discord Bot Client
  const client = createDiscordClient();
  await startBot(client);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[SYSTEM] Gracefully shutting down NekoAI bot...');
    modelManager.destroy();
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[FATAL] Bootstrap error:', err);
  process.exit(1);
});

