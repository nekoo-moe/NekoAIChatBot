import { SearchProvider, SearchResultItem } from './types.js';
import { GoogleScraperProvider } from './googleScraper.js';
import { SearXNGProvider } from './searxngSearch.js';
import { WikipediaSearchProvider } from './wikipediaSearch.js';

export class SearchRouter {
  private static instance: SearchRouter;
  private providers: SearchProvider[];

  private constructor() {
    this.providers = [
      new GoogleScraperProvider(),
      new SearXNGProvider(),
      new WikipediaSearchProvider(),
    ];
  }

  public static getInstance(): SearchRouter {
    if (!SearchRouter.instance) {
      SearchRouter.instance = new SearchRouter();
    }
    return SearchRouter.instance;
  }

  /**
   * Searches the web using multi-provider fallback (Google -> SearXNG -> Wikipedia)
   */
  public async search(query: string, maxResults: number = 5): Promise<SearchResultItem[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const errors: string[] = [];

    for (const provider of this.providers) {
      try {
        const results = await provider.search(cleanQuery, maxResults);
        if (results && results.length > 0) {
          return results;
        }
      } catch (err: any) {
        errors.push(`[${provider.name}]: ${err.message}`);
      }
    }

    console.warn(`[WARN] All search providers failed for query "${cleanQuery}":\n${errors.join('\n')}`);
    return [];
  }

  /**
   * Formats search results into a clean markdown block suitable for LLM injection
   */
  public formatResults(results: SearchResultItem[]): string {
    if (!results || results.length === 0) {
      return 'No web search results found.';
    }

    return results
      .map(
        (r, idx) =>
          `[${idx + 1}] "${r.title}" (${r.source})\nURL: ${r.url}\nSummary: ${r.snippet}`
      )
      .join('\n\n');
  }
}

