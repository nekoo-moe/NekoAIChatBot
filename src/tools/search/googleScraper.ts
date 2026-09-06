import axios from 'axios';
import * as cheerio from 'cheerio';
import { SearchProvider, SearchResultItem } from './types.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

export class GoogleScraperProvider implements SearchProvider {
  public name = 'Google No-Key Scraper';

  public async search(query: string, maxResults: number = 5): Promise<SearchResultItem[]> {
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=${maxResults + 3}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': randomUserAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      timeout: 5000,
    });

    const $ = cheerio.load(response.data);
    const results: SearchResultItem[] = [];

    // Search common Google result containers
    $('div.g, div.tF2Cxc, div.MjjYud').each((_, element) => {
      if (results.length >= maxResults) return;

      const titleEl = $(element).find('h3').first();
      const linkEl = $(element).find('a').first();
      const snippetEl = $(element).find('div.VwiC3b, div.yXK7lf, div.lEBKkf, span.aCOpRe').first();

      const title = titleEl.text().trim();
      const link = linkEl.attr('href') || '';
      const snippet = snippetEl.text().trim();

      if (title && link && link.startsWith('http') && !link.includes('google.com/search')) {
        results.push({
          title,
          url: link,
          snippet: snippet || '(No snippet available)',
          source: 'Google',
        });
      }
    });

    return results;
  }
}
