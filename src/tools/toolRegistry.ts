import axios from 'axios';
import * as cheerio from 'cheerio';
import { SearchRouter } from './search/searchRouter.js';

/**
 * Evaluates an arithmetic expression safely without eval or Function constructor
 */
function safeCalculate(expression: string): { expression: string; result?: number; error?: string } {
  const expr = expression.trim();
  if (!expr) {
    return { expression: expr, error: 'Expression is empty.' };
  }

  // Safety whitelist: only allow digits, arithmetic symbols, parentheses, dots, spaces, and math function names
  if (!/^[0-9\s+\-*/%^().,a-zA-Z]+$/.test(expr)) {
    return { expression: expr, error: 'Expression contains invalid or disallowed characters.' };
  }

  const tokens: string[] = [];
  const regex = /([0-9]+(?:\.[0-9]+)?|[a-zA-Z]+|\+|\-|\*|\/|\%|\^|\(|\))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(expr)) !== null) {
    tokens.push(match[1]);
  }

  if (tokens.length === 0) {
    return { expression: expr, error: 'No valid mathematical tokens found.' };
  }

  let index = 0;

  function parseExpression(): number {
    let result = parseTerm();
    while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
      const op = tokens[index++];
      const term = parseTerm();
      if (op === '+') result += term;
      else result -= term;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parsePower();
    while (index < tokens.length && (tokens[index] === '*' || tokens[index] === '/' || tokens[index] === '%')) {
      const op = tokens[index++];
      const factor = parsePower();
      if (op === '*') result *= factor;
      else if (op === '/') {
        if (factor === 0) throw new Error('Division by zero.');
        result /= factor;
      } else if (op === '%') {
        if (factor === 0) throw new Error('Modulo by zero.');
        result %= factor;
      }
    }
    return result;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (index < tokens.length && tokens[index] === '^') {
      index++;
      const exponent = parsePower(); // right-associative
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parseUnary(): number {
    if (index < tokens.length && tokens[index] === '+') {
      index++;
      return parseUnary();
    }
    if (index < tokens.length && tokens[index] === '-') {
      index++;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    if (index >= tokens.length) {
      throw new Error('Unexpected end of expression.');
    }

    const token = tokens[index++];

    if (token === '(') {
      const result = parseExpression();
      if (index >= tokens.length || tokens[index] !== ')') {
        throw new Error('Mismatched parentheses: missing closing ")".');
      }
      index++; // consume ')'
      return result;
    }

    const num = Number(token);
    if (!isNaN(num)) {
      return num;
    }

    const lower = token.toLowerCase();
    if (lower === 'pi') return Math.PI;
    if (lower === 'e') return Math.E;

    const funcs: Record<string, (x: number) => number> = {
      sqrt: Math.sqrt,
      abs: Math.abs,
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      log: Math.log,
      exp: Math.exp,
    };

    if (funcs[lower]) {
      if (index >= tokens.length || tokens[index] !== '(') {
        throw new Error(`Expected "(" after function "${token}".`);
      }
      index++; // consume '('
      const arg = parseExpression();
      if (index >= tokens.length || tokens[index] !== ')') {
        throw new Error(`Missing closing ")" for function "${token}".`);
      }
      index++; // consume ')'
      return funcs[lower](arg);
    }

    throw new Error(`Unknown mathematical identifier: "${token}".`);
  }

  try {
    const calculated = parseExpression();
    if (index < tokens.length) {
      throw new Error(`Unexpected token remaining: "${tokens.slice(index).join(' ')}"`);
    }
    return { expression: expr, result: calculated };
  } catch (err: any) {
    return { expression: expr, error: err.message };
  }
}

/**
 * Scrapes readable textual content from a webpage URL
 */
async function fetchWebpageContent(rawUrl: string): Promise<{ url: string; title: string; content: string; error?: string }> {
  let url = (rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  try {
    const response = await axios.get(url, {
      timeout: 8000,
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      },
    });

    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, noscript, svg, iframe, form').remove();

    const title = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || 'Untitled';
    let text = $('article').text() || $('main').text() || $('body').text() || '';
    text = text.replace(/\s+/g, ' ').trim();

    if (text.length > 3500) {
      text = text.substring(0, 3500) + '... [nội dung đã được rút gọn để vừa ngữ cảnh]';
    }

    return {
      url,
      title,
      content: text || 'Không tìm thấy nội dung văn bản đọc được từ liên kết này.',
    };
  } catch (err: any) {
    return {
      url,
      title: '',
      content: '',
      error: `Không thể tải trang web (${err.message}).`,
    };
  }
}

/**
 * Retrieves weather data for a specific location
 */
async function getWeather(location: string): Promise<Record<string, any>> {
  const cleanLoc = (location || 'Hanoi').trim();
  try {
    const url = `https://wttr.in/${encodeURIComponent(cleanLoc)}?format=j1`;
    const response = await axios.get(url, {
      timeout: 7000,
      headers: { 'User-Agent': 'curl/8.0.0' },
    });

    if (response.data?.current_condition?.[0]) {
      const curr = response.data.current_condition[0];
      const nearest = response.data.nearest_area?.[0];
      const areaName = nearest?.areaName?.[0]?.value || cleanLoc;
      const country = nearest?.country?.[0]?.value || '';
      const tempC = curr.temp_C;
      const feelsLikeC = curr.FeelsLikeC;
      const humidity = curr.humidity;
      const desc = curr.weatherDesc?.[0]?.value || 'Partly cloudy';
      const windKmph = curr.windspeedKmph;

      return {
        location: `${areaName}${country ? ', ' + country : ''}`,
        temperature_C: `${tempC}°C`,
        feels_like_C: `${feelsLikeC}°C`,
        humidity: `${humidity}%`,
        condition: desc,
        wind_speed: `${windKmph} km/h`,
        summary: `Thời tiết tại ${areaName}: ${tempC}°C (cảm giác thực tế: ${feelsLikeC}°C), tình trạng: ${desc}, độ ẩm: ${humidity}%, gió: ${windKmph} km/h.`,
      };
    }
  } catch (err: any) {
    console.warn(`[WEATHER_TOOL] wttr.in direct fetch failed: ${err.message}. Trying SearchRouter fallback...`);
  }

  const searchRouter = SearchRouter.getInstance();
  const results = await searchRouter.search(`thời tiết ${cleanLoc}`, 2);
  return {
    location: cleanLoc,
    fallbackResults: results,
    formattedText: searchRouter.formatResults(results),
  };
}

/**
 * Returns current date, time, weekday, and year
 */
function getCurrentTime(timezone?: string): Record<string, any> {
  const tz = timezone || 'Asia/Ho_Chi_Minh';
  const now = new Date();

  try {
    const formatted = new Intl.DateTimeFormat('vi-VN', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    return {
      timezone: tz,
      formattedTime: formatted,
      isoTimestamp: now.toISOString(),
      year: now.getFullYear(),
      unixMs: now.getTime(),
    };
  } catch {
    const fallbackFormatted = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    return {
      timezone: 'Asia/Ho_Chi_Minh',
      note: `Múi giờ "${timezone}" không hợp lệ, đã chuyển về mặc định Asia/Ho_Chi_Minh.`,
      formattedTime: fallbackFormatted,
      isoTimestamp: now.toISOString(),
      year: now.getFullYear(),
      unixMs: now.getTime(),
    };
  }
}

export class ToolRegistry {
  public static getToolDefinitions() {
    return [
      {
        type: 'function' as const,
        function: {
          name: 'web_search',
          description:
            'Search the live internet for recent events, real-time facts, current news, documentation, or unknown information. Returns relevant excerpts and URLs.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query to look up on the web.',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_weather',
          description:
            'Get live real-time weather conditions, temperature, humidity, and forecast for a specific city or location.',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'City, region, or location name (e.g. "Hanoi", "Ho Chi Minh", "Da Nang", "Tokyo", "Paris").',
              },
            },
            required: ['location'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_current_time',
          description:
            'Get current date, time, day of the week, year, and timezone info. Default timezone is Vietnam (Asia/Ho_Chi_Minh).',
          parameters: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: 'IANA timezone name (e.g. "Asia/Ho_Chi_Minh", "Asia/Tokyo", "America/New_York", "UTC"). Default: "Asia/Ho_Chi_Minh".',
              },
            },
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'calculate',
          description:
            'Safely evaluate a mathematical arithmetic expression (e.g. "(120 + 35) * 4", "sqrt(144) + 10", "2^10", "15%"). No harmful code execution.',
          parameters: {
            type: 'object',
            properties: {
              expression: {
                type: 'string',
                description: 'Mathematical expression to compute.',
              },
            },
            required: ['expression'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'fetch_webpage',
          description:
            'Fetch and extract readable text content and title from a webpage URL to analyze, read, or summarize articles and web pages.',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The HTTP or HTTPS webpage URL to read.',
              },
            },
            required: ['url'],
          },
        },
      },
    ];
  }

  public static async executeTool(name: string, args: Record<string, any>): Promise<any> {
    if (name === 'web_search') {
      const currentYear = new Date().getFullYear();
      let query = String(args.query || '').trim();

      // Normalize outdated years generated by model hallucinations (2024, 2025 -> currentYear)
      query = query.replace(/\b(2024|2025)\b/g, String(currentYear));

      console.log(`[SEARCH] Executing web_search for query: "${query}"`);
      const searchRouter = SearchRouter.getInstance();
      const results = await searchRouter.search(query, 5);
      return {
        query,
        resultsCount: results.length,
        results,
        formattedText: searchRouter.formatResults(results),
      };
    }

    if (name === 'get_weather') {
      const location = String(args.location || 'Hanoi').trim();
      console.log(`[TOOL] Executing get_weather for location: "${location}"`);
      return await getWeather(location);
    }

    if (name === 'get_current_time') {
      const timezone = args.timezone ? String(args.timezone).trim() : undefined;
      console.log(`[TOOL] Executing get_current_time for timezone: "${timezone || 'Asia/Ho_Chi_Minh'}"`);
      return getCurrentTime(timezone);
    }

    if (name === 'calculate') {
      const expression = String(args.expression || '').trim();
      console.log(`[TOOL] Executing calculate for expression: "${expression}"`);
      return safeCalculate(expression);
    }

    if (name === 'fetch_webpage') {
      const url = String(args.url || '').trim();
      console.log(`[TOOL] Executing fetch_webpage for url: "${url}"`);
      return await fetchWebpageContent(url);
    }

    return { error: `Tool "${name}" not found.` };
  }

  /**
   * Heuristic to proactively detect if a user message likely needs live web info,
   * especially beneficial for free models that don't always reliably output tool calling JSON.
   */
  public static shouldTriggerProactiveSearch(userText: string): string | null {
    const text = userText.toLowerCase();
    const currentYear = new Date().getFullYear();

    // Specific search trigger keywords
    const searchIntents = [
      /\b(tìm kiếm|tra cứu|search web|google|search for|lookup)\s+(.+)/i,
      /\b(tuần này|hôm nay|tháng này|năm nay|dạo này|gần đây|vừa qua)\b/i,
      /\b(tin tức|tin mới|tin nóng|xu hướng|trending|hot trend|sự kiện)\b/i,
      /\b(internet việt|mạng xã hội|báo chí|thời sự)\b/i,
      /\b(có gì mới|chuyện gì đang xảy ra|có gì hot)\b/i,
      /\b(thời tiết|giá vàng|tỉ giá|bitcoin|crypto price|chứng khoán)\b/i,
      /\b(who is the current|what happened today|latest news about|current price of)\s+(.+)/i,
      /\b(bây giờ là năm nào|năm nay là năm bao nhiêu|who won the|what is new in)\b/i,
    ];

    for (const regex of searchIntents) {
      const match = text.match(regex);
      if (match) {
        // Build a targeted search query
        let cleanText = userText.replace(/[?!,.]+/g, ' ').trim();
        // If query doesn't already contain a 4-digit year, append the current year
        if (!/\b\d{4}\b/.test(cleanText)) {
          cleanText = `${cleanText} ${currentYear}`;
        }
        return cleanText;
      }
    }

    return null;
  }
}
