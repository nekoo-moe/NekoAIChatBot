import { LLMRouter } from '../src/llm/llmRouter.js';
import { ProviderConsole } from '../src/bot/console/providerConsole.js';
import { config } from '../src/config.js';

async function runConsoleTests() {
  console.log('[TEST] Starting Discord Provider Console & Runtime State Suite...\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, msg: string) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${msg}`);
      process.exitCode = 1;
    }
  }

  const router = LLMRouter.getInstance();
  const consoleManager = ProviderConsole.getInstance();

  // --- 1. Runtime Provider Switching ---
  console.log('--- 1. Testing Runtime Provider Switching ---');
  router.setActiveProvider('openai');
  assert(router.getActiveProvider() === 'openai', 'Active provider switched to "openai"');

  router.setActiveProvider('gemini');
  assert(router.getActiveProvider() === 'gemini', 'Active provider switched to "gemini"');

  router.setActiveProvider('openrouter');
  assert(router.getActiveProvider() === 'openrouter', 'Active provider switched to "openrouter"');

  router.setActiveProvider('auto');
  assert(router.getActiveProvider() === 'auto', 'Active provider switched to "auto"');

  // --- 2. Model Switching & Availability ---
  console.log('\n--- 2. Testing Model Switching & Availability ---');
  router.setActiveModel('deepseek-chat', 'openai');
  router.setActiveModel('gemini-2.5-flash', 'gemini');
  router.setActiveModel('minimax/minimax-m3:free', 'openrouter');

  const openAiModels = router.getAvailableModels('openai');
  console.log('  OpenAI available models:', openAiModels.slice(0, 4));
  assert(openAiModels.length > 0, 'OpenAI has available models list');

  const geminiModels = router.getAvailableModels('gemini');
  console.log('  Gemini available models:', geminiModels.slice(0, 4));
  assert(geminiModels.length > 0, 'Gemini has available models list');

  const openRouterModels = router.getAvailableModels('openrouter');
  console.log('  OpenRouter available models:', openRouterModels.slice(0, 4));
  assert(openRouterModels.length > 0, 'OpenRouter has available models list');

  // --- 3. Web Search Toggle ---
  console.log('\n--- 3. Testing Web Search Runtime Toggle ---');
  router.toggleWebSearch(false);
  assert(router.isWebSearchEnabled() === false, 'Web search toggled OFF');
  router.toggleWebSearch(true);
  assert(router.isWebSearchEnabled() === true, 'Web search toggled ON');

  // --- 4. Provider Status Summary ---
  console.log('\n--- 4. Testing Provider Status Summary ---');
  const status = router.getProviderStatus();
  console.log('  Status summary:', {
    activeProvider: status.activeProvider,
    activeModel: status.activeModel,
    webSearch: status.webSearchEnabled,
    openaiConfigured: status.openai.configured,
    geminiConfigured: status.gemini.configured,
    openrouterConfigured: status.openrouter.configured,
  });
  assert(status.activeProvider === 'auto', 'Status reports activeProvider as auto');
  assert(typeof status.activeModel === 'string', 'Status reports valid activeModel');

  // --- 5. Discord Console Message UI Builder ---
  console.log('\n--- 5. Testing Discord Console UI Message Structure ---');
  const consolePayload = consoleManager.buildConsoleMessage('Test result ping: 120ms');

  assert(Array.isArray(consolePayload.embeds) && consolePayload.embeds.length === 1, 'Embed generated');
  const embedData = consolePayload.embeds[0].data;
  assert(
    typeof embedData.title === 'string' && embedData.title.includes('Bảng Điều Khiển'),
    'Embed title contains "Bảng Điều Khiển"'
  );
  assert(
    embedData.fields?.some((f) => f.name.includes('Provider Đang Chọn')),
    'Embed contains "Provider Đang Chọn" field'
  );
  assert(
    embedData.fields?.some((f) => f.name.includes('Kết Quả Kiểm Tra Kết Nối')),
    'Embed contains test result field'
  );

  assert(Array.isArray(consolePayload.components) && consolePayload.components.length === 3, 'Generated 3 component ActionRows');

  // Row 1: Provider Select Menu
  const row1 = consolePayload.components[0] as any;
  const providerSelect = row1.components[0];
  assert(providerSelect?.data?.custom_id === 'neko_select_provider', 'Row 1 contains neko_select_provider');
  const providerOptions = providerSelect?.options || providerSelect?.toJSON()?.options;
  assert(providerOptions?.length === 4, 'Provider select has 4 options');

  // Row 2: Model Select Menu
  const row2 = consolePayload.components[1] as any;
  const modelSelect = row2.components[0];
  assert(modelSelect?.data?.custom_id === 'neko_select_model', 'Row 2 contains neko_select_model');
  const modelOptions = modelSelect?.options || modelSelect?.toJSON()?.options;
  assert((modelOptions?.length || 0) > 0, 'Model select has populated options');

  // Row 3: Action Buttons
  const row3 = consolePayload.components[2] as any;
  assert(row3.components.length === 4, 'Row 3 contains 4 action buttons');
  const btnIds = row3.components.map((c: any) => c.data.custom_id);
  console.log('  Action button IDs:', btnIds);
  assert(btnIds.includes('neko_btn_test'), 'Has neko_btn_test button');
  assert(btnIds.includes('neko_btn_toggle_search'), 'Has neko_btn_toggle_search button');
  assert(btnIds.includes('neko_btn_refresh'), 'Has neko_btn_refresh button');
  assert(btnIds.includes('neko_btn_close'), 'Has neko_btn_close button');

  // --- 6. Authorization Logic ---
  console.log('\n--- 6. Testing Authorization Logic ---');
  // Whitelist test
  config.adminDiscordIds = ['123456789'];
  assert(consoleManager.isAuthorized('123456789') === true, 'Authorized whitelisted admin ID');
  assert(consoleManager.isAuthorized('999999999') === false, 'Blocked non-whitelisted user ID');

  // Reset config
  config.adminDiscordIds = [];
  assert(consoleManager.isAuthorized('user_in_dm', null) === true, 'DM allowed when no admin list set');

  console.log(`\n=========================================`);
  console.log(`Test Results: ${passed}/${total} assertions passed.`);
  if (passed === total) {
    console.log('[ALL PASS] Discord Provider Console verified successfully!');
  } else {
    console.error('[FAIL] Some assertions failed.');
    process.exit(1);
  }
}

runConsoleTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
