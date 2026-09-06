import { config } from '../../config.js';

const EMOTION_BADGES: Record<string, string> = {
  happy: '✨ *[Happy]*',
  sad: '💧 *[Sad]*',
  angry: '💢 *[Pout]*',
  think: '🤔 *[Thinking]*',
  surprised: '😲 *[Surprised]*',
  awkward: '😳 *[Flustered]*',
  question: '❓ *[Confused]*',
  curious: '🔍 *[Curious]*',
  neutral: '🌸 *[Calm]*',
};

export class ActParser {
  /**
   * Formats streaming control tokens (<|ACT...|>, <|DELAY...|>, <|CALL...|>) according to configuration
   */
  public static format(text: string): string {
    const mode = config.PARSE_ACT_TOKENS;

    if (mode === 'raw') {
      return text;
    }

    if (mode === 'clean') {
      return this.cleanAllTokens(text);
    }

    // Default 'badges' mode
    return this.renderBadges(text);
  }

  private static cleanAllTokens(text: string): string {
    return text
      .replace(/<\|ACT\s+.*?\|>/gi, '')
      .replace(/<\|DELAY\s+\d+\|>/gi, '')
      .replace(/<\|CALL\s+.*?\|>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*tool_calls>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*invoke>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*.*?>/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .trim();
  }

  private static renderBadges(text: string): string {
    let result = text;

    // Strip any residual DSML or raw XML tool calls
    result = result
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*tool_calls>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*invoke>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*.*?>/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');

    // Replace ACT tokens with cute badges
    result = result.replace(/<\|ACT\s+(\{.*?\})\|>/gi, (_, jsonStr) => {
      try {
        const parsed = JSON.parse(jsonStr);
        let emotionName = '';

        if (typeof parsed.emotion === 'string') {
          emotionName = parsed.emotion.toLowerCase();
        } else if (parsed.emotion && typeof parsed.emotion.name === 'string') {
          emotionName = parsed.emotion.name.toLowerCase();
        }

        const badge = EMOTION_BADGES[emotionName] || (emotionName ? `*[${emotionName}]*` : '');
        const motion = parsed.motion ? ` *(action: ${parsed.motion})*` : '';

        return badge ? `${badge}${motion} ` : '';
      } catch {
        return '';
      }
    });

    // Strip delay tokens for Discord chat readability
    result = result.replace(/<\|DELAY\s+\d+\|>/gi, '');

    // Format call tokens cleanly if any
    result = result.replace(/<\|CALL\s+.*?\|>/gi, '');

    // Clean up multiple extra spaces or blank lines
    return result.replace(/[ \t]{2,}/g, ' ').trim();
  }
}

