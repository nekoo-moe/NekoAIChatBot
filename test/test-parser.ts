import { ActParser } from '../src/bot/utils/actParser.js';
import { chunkMessage } from '../src/bot/utils/chunker.js';

function testParserAndChunker() {
  console.log('🧪 Testing ActParser and Chunker...\n');

  const rawSample =
    '<|ACT {"emotion":"surprised"}|><|DELAY 1|> Wow... You prepared a gift for me? <|ACT {"emotion":"curious"}|><|DELAY 1|> Can I open it now nya~?';

  const badgeRendered = ActParser.format(rawSample);
  console.log('Original Text:\n', rawSample);
  console.log('\nBadge Rendered Text:\n', badgeRendered);

  // Test chunker
  const longText = 'NekoAI is chatting with users! '.repeat(100);
  const chunks = chunkMessage(longText, 100);
  console.log(`\nLong text split into ${chunks.length} chunks (all <= 100 chars):`);
  chunks.slice(0, 3).forEach((c, idx) => console.log(`  Chunk ${idx + 1} (length ${c.length}): ${c.slice(0, 40)}...`));

  const allUnderLimit = chunks.every((c) => c.length <= 100);
  if (badgeRendered.includes('[Surprised]') && badgeRendered.includes('[Curious]') && allUnderLimit) {
    console.log('\n✅ ActParser and Chunker Test PASSED!');
  } else {
    console.error('\n❌ ActParser or Chunker test failed!');
    process.exit(1);
  }
}

testParserAndChunker();

