import { SearchRouter } from '../src/tools/search/searchRouter.js';
import { ToolRegistry } from '../src/tools/toolRegistry.js';

async function testSearch() {
  console.log('[TEST] Testing Multi-Engine No-Key Web Search Router...\n');

  const router = SearchRouter.getInstance();

  // 1. Weather search test
  const weatherQuery = 'dự báo thời tiết hà đông hôm nay';
  console.log(`--- 1. Testing Weather Search: "${weatherQuery}" ---`);
  const weatherTrigger = ToolRegistry.shouldTriggerProactiveSearch(weatherQuery);
  console.log(`  Proactive search triggered: "${weatherTrigger}"`);
  console.assert(weatherTrigger !== null, 'Weather query should trigger proactive search');

  const weatherResults = await router.search(weatherTrigger || weatherQuery, 3);
  console.log(`  Retrieved ${weatherResults.length} weather results:`);
  weatherResults.forEach((r, idx) => {
    console.log(`  [Result #${idx + 1}] (${r.source}): ${r.title}`);
    console.log(`    Snippet: ${r.snippet}`);
  });
  console.assert(weatherResults.length > 0, 'Weather search must return at least 1 result');

  // 2. News / Real-time search test
  const newsQuery = 'tin tức công nghệ AI hôm nay';
  console.log(`\n--- 2. Testing News Search: "${newsQuery}" ---`);
  const newsTrigger = ToolRegistry.shouldTriggerProactiveSearch(newsQuery);
  console.log(`  Proactive search triggered: "${newsTrigger}"`);

  const newsResults = await router.search(newsTrigger || newsQuery, 3);
  console.log(`  Retrieved ${newsResults.length} news results:`);
  newsResults.forEach((r, idx) => {
    console.log(`  [Result #${idx + 1}] (${r.source}): ${r.title}`);
  });
  console.assert(newsResults.length > 0, 'News search must return at least 1 result');

  // 3. Format Context Test
  console.log('\n--- 3. Testing Context Formatting ---');
  const formatted = router.formatResults(weatherResults);
  console.log(formatted);
  console.assert(formatted.includes('URL:'), 'Formatted context must contain URLs');

  console.log('\n[PASS] All Search Router tests passed successfully!');
}

testSearch().catch((err) => {
  console.error('[FAIL] Search test error:', err);
  process.exit(1);
});

