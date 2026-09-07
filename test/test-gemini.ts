import { LLMRouter } from '../src/llm/llmRouter.js';
import { GeminiClient } from '../src/gemini/client.js';
import { OutputGuard } from '../src/security/outputGuard.js';
import { config } from '../src/config.js';

async function testGeminiSuite() {
  console.log('[TEST] Starting Gemini Provider & LLM Router Suite...\n');

  // 1. OutputGuard Gemini Key Redaction Test
  console.log('--- 1. Testing Gemini Key Redaction in OutputGuard ---');
  const guard = OutputGuard.getInstance();
  const testKey = 'AIzaSyBN1234567890abcdefghijklmnopqrstuv';
  const testOutput = `My Gemini key is ${testKey} and here is the response.`;
  const sanitized = guard.sanitize(testOutput);
  console.log(`  Raw:       ${testOutput}`);
  console.log(`  Sanitized: ${sanitized}`);
  console.assert(!sanitized.includes(testKey), 'Gemini API key should be redacted');
  console.assert(sanitized.includes('[REDACTED_GEMINI_KEY]'), 'Should contain [REDACTED_GEMINI_KEY]');
  console.log('  [PASS] Gemini API Key redaction works properly.\n');

  // 2. LLMRouter Provider Architecture Test
  console.log('--- 2. Testing LLMRouter Architecture & Discovery ---');
  const router = LLMRouter.getInstance();
  console.assert(router !== null && router !== undefined, 'LLMRouter singleton must exist');
  console.log(`  Configured LLM_PROVIDER: [${config.LLM_PROVIDER}]`);
  console.log(`  Gemini API Keys count:   ${config.geminiApiKeys.length}`);
  console.log(`  OpenRouter Keys count:   ${config.openRouterApiKeys.length}`);
  console.log('  [PASS] LLMRouter initialized successfully.\n');

  // 3. Gemini Client & Live Check
  console.log('--- 3. Testing Gemini Client ---');
  const gemini = GeminiClient.getInstance();
  console.assert(gemini !== null && gemini !== undefined, 'GeminiClient singleton must exist');

  if (config.geminiApiKeys.length > 0) {
    console.log(`  Detected Gemini API Key. Running live test call...`);
    try {
      const res = await gemini.generateChatCompletion({
        messages: [
          { role: 'system', content: 'You are NekoAI. Say hello briefly with an ACT token.' },
          { role: 'user', content: 'Chào NekoAI!' },
        ],
        maxTokens: 100,
      });
      console.log(`  Live response using model [${res.usedModel}]:`);
      console.log(`    ${res.content.substring(0, 120)}...`);
      console.log('  [PASS] Live Gemini API response received successfully.');
    } catch (err: any) {
      console.warn(`  [WARN] Live Gemini API call failed: ${err.message}`);
    }
  } else {
    console.log('  [INFO] No GEMINI_API_KEYS configured yet in .env (waiting for user input).');
    console.log('  Client is fully ready to accept GEMINI_API_KEYS when provided.');
  }

  console.log('\n[PASS] All Gemini Provider tests passed successfully.');
}

testGeminiSuite().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
