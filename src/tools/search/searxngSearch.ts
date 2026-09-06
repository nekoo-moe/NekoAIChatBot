import axios from 'axios';
import { SearchProvider, SearchResultItem } from './types.js';
import { config } from '../../config.js';

const PUBLIC_SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://searx.tiekoetter.com',
  'https://searx.si',
  'https://search.ononoki.org',
  'https://searx.work',
];

export class SearXNGProvider implements SearchProvider {
  public name = 'SearXNG Metasearch (No Key)';

  public async search(query: string, maxResults: number = 5): Promise<SearchResultItem[]> {
    const candidateUrls: string[] = [];

    if (config.SEARXNG_CUSTOM_URL && config.SEARXNG_CUSTOM_URL.trim()) {
      candidateUrls.push(config.SEARXNG_CUSTOM_URL.trim().replace(/\/+$/, ''));
    }
    candidateUrls.push(...PUBLIC_SEARXNG_INSTANCES);

    let lastError: Error | null = null;

    for (const baseUrl of candidateUrls) {
      try {
        const endpoint = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
        const response = await axios.get(endpoint, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
            Accept: 'application/json',
          },
          timeout: 4000,
        });

        if (response.data && Array.isArray(response.data.results)) {
          const results: SearchResultItem[] = response.data.results
            .slice(0, maxResults)
            .map((item: any) => ({
              title: item.title || 'Untitled',
              url: item.url || '',
              snippet: item.content || item.snippet || '',
              source: `SearXNG (${item.engine || 'meta'})`,
            }))
            .filter((item: SearchResultItem) => item.url && item.url.startsWith('http'));

          if (results.length > 0) {
            return results;
          }
        }
      } catch (err: any) {
        lastError = err;
        // Try next candidate instance
      }
    }

    throw new Error(`All SearXNG instances failed or restricted JSON. Last error: ${lastError?.message}`);
  }
}
