import { ActParser } from '../src/bot/utils/actParser.js';

async function testFullNekoWeb() {
  console.log('[TEST] Testing Full NekoAI + OpenRouter Web Plugin for "giá vàng hôm nay"...');
  const apiKey = config.openRouterApiKeys[0];

  const payload = {
    model: 'openrouter/free',
    messages: [
      {
        role: 'system',
        content: getNekoSystemPrompt(),
      },
      {
        role: 'user',
        content: '<user_input author="User">\ngiá vàng hôm nay tại Việt Nam thế nào rồi em?\n</user_input>',
      },
    ],
    plugins: [
      {
        id: 'web',
        max_results: 5,
      },
    ],
  };

  try {
    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 45000,
    });

    const choice = res.data.choices?.[0];
    console.log('Model used:', res.data.model);
    console.log('Raw output:\n', choice?.message?.content);
    console.log('\nParsed Discord output:\n', ActParser.format(choice?.message?.content || ''));
  } catch (err: any) {
    console.error('Error:', err.response?.data || err.message);
  }
}

testFullNekoWeb();

