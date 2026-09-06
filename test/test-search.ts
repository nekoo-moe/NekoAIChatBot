import { SearchRouter } from '../src/tools/search/searchRouter.js';

async function testSearch() {
  console.log('[TEST] Testing Multi-Engine No-Key Web Search Router...\n');

  const router = SearchRouter.getInstance();
  const query = 'TypeScript programming language';

  console.log(`[SEARCH] Query: "${query}"`);
  const results = await router.search(query, 3);

  console.log(`\nRetrieved ${results.length} results:`);
  results.forEach((r, idx) => {
    console.log(`\n[Result #${idx + 1}] (${r.source})`);
    console.log(`  Title:   ${r.title}`);
    console.log(`  URL:     ${r.url}`);
    console.log(`  Snippet: ${r.snippet.slice(0, 120)}...`);
  });

  const formatted = router.formatResults(results);
  console.log('\nFormatted Markdown context:');
  console.log(formatted.slice(0, 300) + '...');

  if (results.length > 0) {
    console.log('\n[PASS] No-Key Web Search test passed.');
  } else {
    console.warn('\n[WARN] Search returned 0 results (network or temporary rate limit).');
  }
}

testSearch().catch((err) => {
  console.error('Search test error:', err);
  process.exit(1);
});

