export function extractCleanAnswer(rawContent: string): { answer: string; isComplete: boolean } {
  let text = (rawContent || '').trim();

  // 1. Remove XML thinking tags: <think>...</think>, <thought>...</thought>, etc.
  text = text.replace(/<(think|thought|reasoning|reflection|analysis)>[\s\S]*?<\/\1>/gi, '').trim();

  // 2. Look for character ACT token anchor
  const actIndex = text.search(/<\|ACT\s+.*?\|>/i);
  if (actIndex !== -1) {
    const responsePart = text.substring(actIndex).trim();
    if (responsePart.length > 0) {
      return { answer: responsePart, isComplete: true };
    }
  }

  // 3. Response boundary markers
  const responseHeaderRegex = /(?:^|\n)(?:(?:Final\s+)?(?:Response|Output|Answer)|Draft|Structure|Let's craft the response:?)\s*:\s*([\s\S]+)$/i;
  const headerMatch = text.match(responseHeaderRegex);
  if (headerMatch && headerMatch[1]) {
    const candidate = headerMatch[1].trim().replace(/^(?:Structure|Then body|Body|Output):\s*/gim, '').trim();
    if (candidate.length > 0) {
      return { answer: candidate, isComplete: true };
    }
  }

  // 4. Check if text is purely thinking/planning that never reached the response
  const isPureThinking = /^(?:(?:\*\*|##|#)?\s*(?:Here'?s (?:a\s+)?|My\s+)?(?:thinking|thought|reasoning)(?:\s+process)?(?::|\*\*|##|#)?|1\.\s+Analyze User Input)/i.test(text);
  if (isPureThinking) {
    return { answer: '', isComplete: false };
  }

  return { answer: text, isComplete: true };
}

// Test Case 1: Incomplete thinking dump from media_1788702527794.png
const incompleteThinking = `Here's a thinking process:
1. Analyze User Input:
2. User: .heiznerd
3. Formulate Response Strategy:
So I'll use Vietnamese.`;

const res1 = extractCleanAnswer(incompleteThinking);
console.log('Test 1 (Incomplete thinking rejected):', !res1.isComplete ? '[PASS]' : '[FAIL]');

// Test Case 2: Complete thinking with ACT response from media_1788700831354.png
const thinkingWithAct = `Here's a thinking process:
1. Analyze User Input:
Structure:
<|ACT {"emotion":"happy"}|> Hello! Gold price is 144M.

Then body:
- SJC: 144M`;

const res2 = extractCleanAnswer(thinkingWithAct);
console.log('Test 2 (Thinking with ACT extracted):', res2.isComplete && res2.answer.startsWith('<|ACT') ? '[PASS]' : '[FAIL]');

// Test Case 3: DeepSeek <think> tag
const thinkTag = `<think>Some deep thoughts</think><|ACT {"emotion":"neutral"}|> I am ready nya~`;
const res3 = extractCleanAnswer(thinkTag);
console.log('Test 3 (Think tag stripped):', res3.isComplete && res3.answer === '<|ACT {"emotion":"neutral"}|> I am ready nya~' ? '[PASS]' : '[FAIL]');

// Test Case 4: Pure direct answer
const direct = `<|ACT {"emotion":"happy"}|> Xin chào bạn nya~!`;
const res4 = extractCleanAnswer(direct);
console.log('Test 4 (Direct answer intact):', res4.isComplete && res4.answer === direct ? '[PASS]' : '[FAIL]');

if (!res1.isComplete && res2.isComplete && res3.isComplete && res4.isComplete) {
  console.log('\n[PASS] All thinking extraction test cases passed.');
} else {
  console.error('\n[FAIL] Some tests failed.');
  process.exit(1);
}

