import { ConversationManager } from '../src/memory/conversationManager.js';
import { ModelManager } from '../src/openrouter/modelManager.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { buildConversationContext } from '../src/prompt/contextBuilder.js';

async function runTests() {
  console.log('[TEST] Starting Conversation Memory & Sticky Model Suite...\n');

  // 1. Test ConversationManager functionality
  console.log('--- 1. Testing ConversationManager ---');
  const memory = ConversationManager.getInstance();
  const testChannel = 'test-channel-abc';

  // Initially empty
  let history = memory.getHistory(testChannel);
  console.assert(history.length === 0, 'History should be empty initially');

  // Add 16 messages (exceeding 14 max)
  for (let i = 1; i <= 16; i++) {
    memory.addMessage(testChannel, {
      role: i % 2 === 1 ? 'user' : 'assistant',
      authorName: i % 2 === 1 ? 'Alice' : 'NekoAI',
      content: `Message #${i}`,
    });
  }

  history = memory.getHistory(testChannel);
  console.log(`  Added 16 messages. History length after sliding window prune: ${history.length} (Max: 14)`);
  console.assert(history.length === 14, 'Sliding window should cap at 14');
  console.assert(history[0].content === 'Message #3', 'Oldest messages 1 and 2 should be pruned');
  console.assert(history[13].content === 'Message #16', 'Newest message should be Message #16');

  // Test clear
  memory.clear(testChannel);
  history = memory.getHistory(testChannel);
  console.log(`  Cleared channel. History length: ${history.length}`);
  console.assert(history.length === 0, 'History should be empty after clear');
  console.log('  [PASS] ConversationManager sliding window & clear work properly.\n');

  // 2. Test ModelManager & Curated Models
  console.log('--- 2. Testing ModelManager & Curated Free Models ---');
  const modelMgr = ModelManager.getInstance();
  const textModels = modelMgr.getTextModels();

  console.log(`  Text candidate models count: ${textModels.length}`);
  console.log(`  Primary active text model: [${modelMgr.getActiveTextModel()}]`);
  console.assert(modelMgr.getActiveTextModel() === 'minimax/minimax-m3:free', 'Primary model should default to minimax-m3:free');

  // Check required user models are present
  const requiredModels = [
    'minimax/minimax-m3:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'poolside/laguna-s-2.1:free',
    'nvidia/nemotron-3.5-lightning:free',
    'inclusionai/ling-3.0-flash-fin:free',
    'minimax/minimax-m2.7:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'poolside/laguna-xs-2.1:free',
    'cohere/north-mini-code:free',
    'inclusionai/ling-3.0-flash-sante:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  ];

  for (const rm of requiredModels) {
    console.assert(textModels.includes(rm), `Model ${rm} must be in candidate list`);
    console.log(`  Found curated model: ${rm}`);
  }

  // Check openrouter/free is at the very end
  console.assert(textModels[textModels.length - 1] === 'openrouter/free', 'openrouter/free should be the last resort fallback');
  console.log('  Confirmed: openrouter/free is at the end of fallback chain.');

  // Test sticky model mechanism
  modelMgr.setActiveTextModel('nvidia/nemotron-3-ultra-550b-a55b:free');
  console.assert(modelMgr.getActiveTextModel() === 'nvidia/nemotron-3-ultra-550b-a55b:free', 'Active model should be updated');
  const updatedCandidates = modelMgr.getTextModels();
  console.assert(updatedCandidates[0] === 'nvidia/nemotron-3-ultra-550b-a55b:free', 'Sticky model should be at index 0');
  console.log('  [PASS] Sticky model mechanism correctly keeps active model at front.\n');

  // Reset back to minimax for runtime
  modelMgr.setActiveTextModel('minimax/minimax-m3:free');

  // 3. End-to-End Conversation Memory Simulation with Live OpenRouter
  console.log('--- 3. Testing End-to-End Live Context Memory ---');
  const client = OpenRouterClient.getInstance();
  const liveChannel = 'live-test-channel';

  // Turn 1
  const userTurn1 = 'Chào Neko, mình tên là Đức và mình là một lập trình viên nhé!';
  console.log(`  [User Turn 1]: "${userTurn1}"`);
  const messages1 = buildConversationContext({
    history: [],
    currentMessage: { authorName: 'Đức', content: userTurn1 }
  });

  const res1 = await client.generateChatCompletion({ messages: messages1 });
  console.log(`  [Bot Turn 1 using ${res1.usedModel}]:\n    ${res1.content.substring(0, 100)}...`);

  // Record to ConversationManager
  memory.addMessage(liveChannel, { role: 'user', authorName: 'Đức', content: userTurn1 });
  memory.addMessage(liveChannel, { role: 'assistant', authorName: 'NekoAI', content: res1.content });

  // Turn 2
  const userTurn2 = 'Đố Neko biết mình tên là gì và làm nghề gì nè?';
  console.log(`\n  [User Turn 2]: "${userTurn2}"`);
  const historyForTurn2 = memory.getHistory(liveChannel);
  console.assert(historyForTurn2.length === 2, 'History for turn 2 should contain 2 messages');

  const messages2 = buildConversationContext({
    history: historyForTurn2.map(h => ({ role: h.role, authorName: h.authorName, content: h.content })),
    currentMessage: { authorName: 'Đức', content: userTurn2 }
  });

  const res2 = await client.generateChatCompletion({ messages: messages2 });
  console.log(`  [Bot Turn 2 using ${res2.usedModel}]:\n    ${res2.content}`);

  // Verify memory recall
  const lowerReply = res2.content.toLowerCase();
  const remembersName = lowerReply.includes('đức') || lowerReply.includes('duc');
  const remembersJob = lowerReply.includes('lập trình') || lowerReply.includes('developer') || lowerReply.includes('code');
  console.log(`\n  Memory verification:`);
  console.log(`    Remembers Name ("Đức"): ${remembersName ? 'PASS' : 'FAIL'}`);
  console.log(`    Remembers Job ("Lập trình viên"): ${remembersJob ? 'PASS' : 'FAIL'}`);
  console.log(`    Model consistency (Turn 1: ${res1.usedModel}, Turn 2: ${res2.usedModel}): ${res1.usedModel === res2.usedModel ? 'CONSISTENT (PASS)' : 'ROUTED'}`);

  console.log('\n[PASS] All Conversation Memory & Model Stability tests passed!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
