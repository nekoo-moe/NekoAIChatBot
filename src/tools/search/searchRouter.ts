import axios from 'axios';
import * as cheerio from 'cheerio';
import { SearchProvider, SearchResultItem } from './types.js';
import { GoogleScraperProvider } from './googleScraper.js';
import { SearXNGProvider } from './searxngSearch.js';
import { WikipediaSearchProvider } from './wikipediaSearch.js';

export class WeatherSearchProvider implements SearchProvider {
  public name = 'Weather (wttr.in)';

  public async search(query: string, maxResults: number = 2): Promise<SearchResultItem[]> {
    const isWeather = /\b(thời tiết|nhiệt độ|mưa|nắng|weather|forecast|dự báo)\b/i.test(query);
    if (!isWeather) return [];

    let location = 'Hanoi';
    if (/hà\s*đông/i.test(query)) {
      location = 'Ha_Dong';
    } else if (/hồ\s*chí\s*minh|sài\s*gòn|tphcm|hcm/i.test(query)) {
      location = 'Ho_Chi_Minh';
    } else if (/đà\s*nẵng/i.test(query)) {
      location = 'Da_Nang';
    } else if (/hải\s*phòng/i.test(query)) {
      location = 'Hai_Phong';
    } else if (/cần\s*thơ/i.test(query)) {
      location = 'Can_Tho';
    } else if (/nha\s*trang/i.test(query)) {
      location = 'Nha_Trang';
    } else if (/huế/i.test(query)) {
      location = 'Hue';
    } else if (/đà\s*lạt/i.test(query)) {
      location = 'Da_Lat';
    } else if (/vũng\s*tàu/i.test(query)) {
      location = 'Vung_Tau';
    } else {
      const match = query.match(/(?:ở|tại|khu vực|thành phố|tỉnh)\s+([A-Za-zÀ-ỹ\s]+)/i);
      if (match && match[1]) {
        location = match[1].trim().replace(/\s+/g, '_');
      }
    }

    try {
      const response = await axios.get(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
        timeout: 6000,
        headers: { 'User-Agent': 'curl/8.0.0' },
      });

      if (response.data?.current_condition?.[0]) {
        const curr = response.data.current_condition[0];
        const displayNames: Record<string, string> = {
          Ha_Dong: 'Hà Đông',
          Hanoi: 'Hà Nội',
          Ho_Chi_Minh: 'Hồ Chí Minh',
          Da_Nang: 'Đà Nẵng',
          Hai_Phong: 'Hải Phòng',
          Can_Tho: 'Cần Thơ',
          Nha_Trang: 'Nha Trang',
          Hue: 'Huế',
          Da_Lat: 'Đà Lạt',
          Vung_Tau: 'Vũng Tàu',
        };
        const locationName = displayNames[location] || location.replace(/_/g, ' ');
        const tempC = curr.temp_C;
        const feelsLikeC = curr.FeelsLikeC;
        const humidity = curr.humidity;
        const desc = curr.weatherDesc?.[0]?.value || 'Partly Cloudy';
        const windKmph = curr.windspeedKmph;

        const snippet = `Nhiệt độ hiện tại: ${tempC}°C (Cảm giác thực tế: ${feelsLikeC}°C). Độ ẩm: ${humidity}%. Tình trạng thời tiết: ${desc}. Tốc độ gió: ${windKmph} km/h. Khí áp: ${curr.pressure} hPa.`;

        return [
          {
            title: `Dữ liệu thời tiết trực tiếp tại ${locationName} hôm nay`,
            url: `https://wttr.in/${location}`,
            snippet,
            source: 'Khí tượng wttr.in thời gian thực',
          },
        ];
      }
    } catch (err: any) {
      console.warn(`[WEATHER] wttr.in fetch failed: ${err.message}`);
    }

    return [];
  }
}

export class GoogleNewsSearchProvider implements SearchProvider {
  public name = 'Google News Real-time RSS';

  public async search(query: string, maxResults: number = 4): Promise<SearchResultItem[]> {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=vi&gl=VN&ceid=VN:vi`;
      const response = await axios.get(url, {
        timeout: 6000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          Accept: 'application/rss+xml,application/xml,text/xml,*/*',
        },
      });

      const $ = cheerio.load(response.data, { xmlMode: true });
      const results: SearchResultItem[] = [];

      $('item').each((_, element) => {
        if (results.length >= maxResults) return;

        const title = $(element).find('title').text().trim();
        const link = $(element).find('link').text().trim();
        const pubDate = $(element).find('pubDate').text().trim();
        const source = $(element).find('source').text().trim() || 'Báo điện tử';

        if (title && link) {
          results.push({
            title,
            url: link,
            snippet: `Ngày đăng: ${pubDate}. Nguồn: ${source}. Nội dung: ${title}`,
            source: `Google News (${source})`,
          });
        }
      });

      return results;
    } catch (err: any) {
      console.warn(`[GOOGLE_NEWS] RSS fetch failed: ${err.message}`);
      return [];
    }
  }
}

export class SearchRouter {
  private static instance: SearchRouter;
  private weatherProvider: WeatherSearchProvider;
  private googleNewsProvider: GoogleNewsSearchProvider;
  private fallbackProviders: SearchProvider[];

  private constructor() {
    this.weatherProvider = new WeatherSearchProvider();
    this.googleNewsProvider = new GoogleNewsSearchProvider();
    this.fallbackProviders = [
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
   * Searches the web using intelligent routing (Weather -> Google News RSS -> General Search -> Wikipedia)
   */
  public async search(query: string, maxResults: number = 5): Promise<SearchResultItem[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const allResults: SearchResultItem[] = [];

    // 1. If query is weather related, check WeatherSearchProvider first
    if (/\b(thời tiết|nhiệt độ|weather|forecast|mưa|nắng)\b/i.test(cleanQuery)) {
      try {
        const weatherResults = await this.weatherProvider.search(cleanQuery, 1);
        if (weatherResults.length > 0) {
          allResults.push(...weatherResults);
        }
      } catch {}
    }

    // 2. Fetch latest real-time news & facts from Google News RSS
    try {
      const newsResults = await this.googleNewsProvider.search(cleanQuery, maxResults - allResults.length);
      if (newsResults.length > 0) {
        allResults.push(...newsResults);
      }
    } catch {}

    if (allResults.length >= maxResults) {
      return allResults.slice(0, maxResults);
    }

    // 3. Fallback to general search providers (Google Scraper, SearXNG, Wikipedia)
    for (const provider of this.fallbackProviders) {
      try {
        const results = await provider.search(cleanQuery, maxResults - allResults.length);
        if (results && results.length > 0) {
          allResults.push(...results);
          if (allResults.length >= maxResults) {
            return allResults.slice(0, maxResults);
          }
        }
      } catch {}
    }

    return allResults.slice(0, maxResults);
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

