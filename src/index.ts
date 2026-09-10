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

  const hasOpenRouter = config.openRouterApiKeys && config.openRouterApiKeys.length > 0;
  const hasGemini = config.geminiApiKeys && config.geminiApiKeys.length > 0;
  const hasOpenAI =
    (config.openaiApiKeys && config.openaiApiKeys.length > 0) ||
    (config.OPENAI_API_BASE && !config.OPENAI_API_BASE.includes('api.openai.com'));

  if (!hasOpenRouter && !hasGemini && !hasOpenAI) {
    console.error('[CONFIG] Missing API keys! Please configure OPENAI_API_KEYS, GEMINI_API_KEYS, or OPENROUTER_API_KEYS in .env.');
    process.exit(1);
  }

  console.log(`[CONFIG] Active Provider Mode: [${config.LLM_PROVIDER.toUpperCase()}]`);
  console.log(`[CONFIG] OpenAI-Compatible: [${hasOpenAI ? 'CONFIGURED (' + config.openaiApiKeys.length + ' key(s))' : 'NOT SET'}]`);
  console.log(`[CONFIG] Google Gemini: [${hasGemini ? 'CONFIGURED (' + config.geminiApiKeys.length + ' key(s))' : 'NOT SET'}]`);
  console.log(`[CONFIG] OpenRouter: [${hasOpenRouter ? 'CONFIGURED (' + config.openRouterApiKeys.length + ' key(s))' : 'NOT SET'}]`);
  if (config.adminDiscordIds.length > 0) {
    console.log(`[SECURITY] Admin Console Users: [${config.adminDiscordIds.join(', ')}]`);
  }
  console.log(`[SECURITY] Prompt injection defense level: [${config.INJECTION_DEFENSE_LEVEL.toUpperCase()}]`);
  console.log(`[SEARCH] Real-time web search: [${config.ENABLE_WEB_SEARCH ? 'ENABLED' : 'DISABLED'}]`);
  console.log(`[FORMATTER] Emotion ACT tokens mode: [${config.PARSE_ACT_TOKENS.toUpperCase()}]`);

  // 1. Initialize OpenRouter dynamic model discovery & rotation if enabled
  const modelManager = ModelManager.getInstance();
  if (hasOpenRouter) {
    await modelManager.initialize();
  }

  // 2. Start Discord Bot Client
  const client = createDiscordClient();
  await startBot(client);

  // 3. Lightweight HTTP health-check server for Cloud platforms (Hugging Face Spaces, Koyeb, etc.)
  const port = Number(process.env.PORT) || 7860;
  const server = (await import('node:http')).createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'online',
          name: 'NekoAI Discord Bot',
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[HTTP] Cloud health check server listening on port ${port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[SYSTEM] Gracefully shutting down NekoAI bot...');
    server.close();
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

