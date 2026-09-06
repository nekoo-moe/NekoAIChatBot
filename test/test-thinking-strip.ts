function stripThinkingProcess(text: string): string {
  let cleaned = text;

  // 1. Remove XML <think>...</think> tags
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Remove "Here's a thinking process:" or "Thinking process:" preamble up to the first <|ACT token
  const thinkingUpToActRegex = /^(?:Here'?s a (?:thinking|thought) process:?|Thinking process:?)[\s\S]*?(?=(<\|ACT\s+.*?\|>))/i;
  if (thinkingUpToActRegex.test(cleaned)) {
    cleaned = cleaned.replace(thinkingUpToActRegex, '').trim();
  }

  // 3. In case <|ACT is missing or wrapped, check for "Structure:" / "Response:" marker
  if (/^(?:Here'?s a (?:thinking|thought) process:?|Thinking process:?)/i.test(cleaned)) {
    const match = cleaned.match(/(?:Structure|Final response|Response):\s*([\s\S]+)$/i);
    if (match && match[1]) {
      cleaned = match[1].trim();
    }
  }

  // 4. Remove residual meta labels like "Structure:" or "Then body:"
  cleaned = cleaned.replace(/^(?:Structure|Then body|Body|Response):\s*/gim, '').trim();

  return cleaned;
}

const sampleWithAct = `Here's a thinking process:

1. Analyze User Input:
2. User says: "giá vàng hôm nay"
3. Context: I'm NekoAI, a VTuber AI created by Neko Ayaka

Structure:
<|ACT {"emotion":"happy"}|> Good morning! Let me check the gold prices for my dear user today~

Then body:
- Gold bar prices: SJC, DOJI, PNJ are 144.6 - 147.6 million VND/liang
- World gold: ~4,415.7 USD/oz

Citations:
- [voh.com.vn](https://voh.com.vn)
- [vov.vn](https://vov.vn)`;

console.log('[TEST] Running stripThinkingProcess test...');
const result = stripThinkingProcess(sampleWithAct);
console.log('Result:\n', result);

if (
  !result.includes("Here's a thinking process") &&
  !result.includes('Analyze User Input') &&
  !result.includes('Then body:') &&
  result.includes('<|ACT {"emotion":"happy"}|>') &&
  result.includes('144.6 - 147.6')
) {
  console.log('\n[PASS] Thinking process stripped cleanly.');
} else {
  console.error('\n[FAIL] Thinking process test failed.');
  process.exit(1);
}

