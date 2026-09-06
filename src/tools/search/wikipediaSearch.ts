import axios from 'axios';
import { SearchProvider, SearchResultItem } from './types.js';

export class WikipediaSearchProvider implements SearchProvider {
  public name = 'Wikipedia Knowledge (No Key)';

  public async search(query: string, maxResults: number = 4): Promise<SearchResultItem[]> {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&utf8=&format=json&srlimit=${maxResults}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'NekoAIChatBot/1.0 (Discord Bot; contact@nekoai.local)',
      },
      timeout: 8000,
    });

    const searchHits = response.data?.query?.search;
    if (!Array.isArray(searchHits) || searchHits.length === 0) {
      return [];
    }

    const results: SearchResultItem[] = [];

    for (const hit of searchHits) {
      const title = hit.title;
      const cleanSnippet = (hit.snippet || '').replace(/<[^>]*>/g, '');
      const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;

      results.push({
        title,
        url: pageUrl,
        snippet: cleanSnippet,
        source: 'Wikipedia',
      });
    }

    return results;
  }
}

