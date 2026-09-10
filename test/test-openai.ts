import { ToolRegistry } from '../src/tools/toolRegistry.js';
import { OutputGuard } from '../src/security/outputGuard.js';
import { OpenAIClient } from '../src/openai/client.js';
import { config } from '../src/config.js';

async function runTests() {
  console.log('[TEST] Starting OpenAI Provider & Accompanying Tools Suite...\n');

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

  // --- 1. Current Time Tool Tests ---
  console.log('--- 1. Testing Tool: get_current_time ---');
  const timeResult = await ToolRegistry.executeTool('get_current_time', { timezone: 'Asia/Ho_Chi_Minh' });
  console.log('  get_current_time output:', timeResult);
  assert(typeof timeResult.formattedTime === 'string', 'Returned formattedTime string');
  assert(timeResult.timezone === 'Asia/Ho_Chi_Minh', 'Timezone matches Asia/Ho_Chi_Minh');
  assert(typeof timeResult.year === 'number' && timeResult.year >= 2024, 'Valid year returned');

  // --- 2. Safe Calculator Tool Tests ---
  console.log('\n--- 2. Testing Tool: calculate ---');
  const calc1 = await ToolRegistry.executeTool('calculate', { expression: '(120 + 35) * 4' });
  console.log('  (120 + 35) * 4 =', calc1.result);
  assert(calc1.result === 620, 'Evaluated (120 + 35) * 4 == 620');

  const calc2 = await ToolRegistry.executeTool('calculate', { expression: '2 ^ 10' });
  console.log('  2 ^ 10 =', calc2.result);
  assert(calc2.result === 1024, 'Evaluated 2 ^ 10 == 1024');

  const calc3 = await ToolRegistry.executeTool('calculate', { expression: 'sqrt(144) + abs(-10)' });
  console.log('  sqrt(144) + abs(-10) =', calc3.result);
  assert(calc3.result === 22, 'Evaluated sqrt(144) + abs(-10) == 22');

  const calc4 = await ToolRegistry.executeTool('calculate', { expression: 'process.exit(1)' });
  console.log('  Unsafe expression handling:', calc4.error);
  assert(!!calc4.error, 'Blocked unsafe expression with identifier process.exit');

  // --- 3. Webpage Scraper Tool Tests ---
  console.log('\n--- 3. Testing Tool: fetch_webpage ---');
  const pageResult = await ToolRegistry.executeTool('fetch_webpage', { url: 'https://example.com' });
  console.log('  example.com Title:', pageResult.title);
  console.log('  Content snippet:', String(pageResult.content || '').substring(0, 80));
  assert(pageResult.title.toLowerCase().includes('example'), 'Scraped example.com title successfully');
  assert(pageResult.content.length > 20, 'Extracted readable text content from example.com');

  // --- 4. Weather Tool Tests ---
  console.log('\n--- 4. Testing Tool: get_weather ---');
  const weatherResult = await ToolRegistry.executeTool('get_weather', { location: 'Hanoi' });
  console.log('  Weather in Hanoi:', weatherResult.summary || weatherResult.formattedText || weatherResult);
  assert(
    !!(weatherResult.temperature_C || weatherResult.summary || weatherResult.formattedText),
    'Weather data retrieved successfully'
  );

  // --- 5. OutputGuard Redaction for OpenAI Keys ---
  console.log('\n--- 5. Testing OutputGuard: OpenAI API Key Redaction ---');
  const rawWithKey = 'My key is sk-proj-1234567890abcdef1234567890abcdef12345678 and do not leak it nya~';
  const sanitized = OutputGuard.getInstance().sanitize(rawWithKey);
  console.log('  Sanitized output:', sanitized);
  assert(!sanitized.includes('sk-proj-'), 'Redacted sk-proj OpenAI API key');
  assert(sanitized.includes('[REDACTED_OPENAI_KEY]'), 'Replaced with [REDACTED_OPENAI_KEY]');

  // --- 6. Tool Definitions Schema Validation ---
  console.log('\n--- 6. Testing Tool Definitions Schema ---');
  const toolDefs = ToolRegistry.getToolDefinitions();
  const toolNames = toolDefs.map((t) => t.function.name);
  console.log('  Registered tool names:', toolNames);
  assert(toolNames.includes('web_search'), 'web_search tool is registered');
  assert(toolNames.includes('get_weather'), 'get_weather tool is registered');
  assert(toolNames.includes('get_current_time'), 'get_current_time tool is registered');
  assert(toolNames.includes('calculate'), 'calculate tool is registered');
  assert(toolNames.includes('fetch_webpage'), 'fetch_webpage tool is registered');
  assert(toolDefs.length === 5, 'Total 5 function tools registered');

  // --- 7. OpenAIClient Initialization & Base URL ---
  console.log('\n--- 7. Testing OpenAIClient Singleton & Configuration ---');
  const client = OpenAIClient.getInstance();
  const baseUrl = client.getBaseUrl();
  console.log('  OpenAI API Base URL:', baseUrl);
  assert(typeof baseUrl === 'string' && baseUrl.startsWith('http'), 'Base URL is valid HTTP/HTTPS endpoint');

  console.log(`\n=========================================`);
  console.log(`Test Results: ${passed}/${total} assertions passed.`);
  if (passed === total) {
    console.log('[ALL PASS] OpenAI Provider and Tool Suite verified successfully!');
  } else {
    console.error('[FAIL] Some assertions failed.');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
