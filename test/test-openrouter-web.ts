import axios from 'axios';
import { config } from '../src/config.js';

async function testOpenRouterWeb() {
  console.log('[TEST] Testing OpenRouter Web Plugin...');
  const apiKey = config.openRouterApiKeys[0];
  console.log('Using API Key:', apiKey ? apiKey.slice(0, 15) + '...' : 'NONE');

  // Test with plugins: [{ id: 'web' }] or model: '...:online'
  try {
    const payload = {
      model: 'openrouter/free',
      messages: [
        {
          role: 'user',
          content: 'Giá vàng hôm nay tại Việt Nam là bao nhiêu? Cho tôi biết chi tiết.',
        },
      ],
      plugins: [
        {
          id: 'web',
          max_results: 5,
        },
      ],
      reasoning: {
        exclude: true,
      },
    };

    console.log('Sending request to OpenRouter with web plugin...');
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log('Status:', response.status);
    console.log('Model used:', response.data.model);
    console.log('Choice content:');
    console.log(response.data.choices?.[0]?.message?.content);
    if (response.data.choices?.[0]?.message?.annotations) {
      console.log('Annotations (citations):', JSON.stringify(response.data.choices[0].message.annotations, null, 2));
    }
  } catch (err: any) {
    console.error('Error testing web plugin:');
    if (err.response) {
      console.error('HTTP Status:', err.response.status);
      console.error('Response data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
  }
}

testOpenRouterWeb();
