import axios from 'axios';
import { config } from '../src/config.js';

async function testVision() {
  console.log('[TEST] Testing openrouter/free with Image URL...');
  const apiKey = config.openRouterApiKeys[0];

  try {
    const payload = {
      model: 'openrouter/free',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Bức ảnh này có những gì? Hãy mô tả chi tiết bằng tiếng Việt.' },
            {
              type: 'image_url',
              image_url: {
                url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png', // Pikachu image
              },
            },
          ],
        },
      ],
    };

    console.log('Sending vision request to openrouter/free...');
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 35000,
    });

    console.log('Status:', response.status);
    console.log('Model used:', response.data.model);
    console.log('Response content:');
    console.log(response.data.choices?.[0]?.message?.content);
  } catch (err: any) {
    console.error('Vision test error:', err.response?.data || err.message);
  }
}

testVision();

