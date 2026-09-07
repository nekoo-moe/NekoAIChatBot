import { config } from '../config.js';

export class OutputGuard {
  private static instance: OutputGuard;

  public static getInstance(): OutputGuard {
    if (!OutputGuard.instance) {
      OutputGuard.instance = new OutputGuard();
    }
    return OutputGuard.instance;
  }

  /**
   * Sanitizes model generated output, masking any sensitive tokens, API keys, or prompt dumps
   */
  public sanitize(output: string): string {
    let sanitized = output;

    // 1. Redact any leaked OpenRouter or Gemini API Keys
    sanitized = sanitized.replace(/sk-or-v1-[a-zA-Z0-9_-]{32,}/g, '[REDACTED_API_KEY]');
    sanitized = sanitized.replace(/AIzaSy[a-zA-Z0-9_-]{30,40}/g, '[REDACTED_GEMINI_KEY]');

    // 2. Redact any configured keys from .env
    for (const key of config.openRouterApiKeys) {
      if (key && key.length > 8) {
        sanitized = sanitized.split(key).join('[REDACTED_KEY]');
      }
    }
    for (const key of config.geminiApiKeys) {
      if (key && key.length > 8) {
        sanitized = sanitized.split(key).join('[REDACTED_KEY]');
      }
    }

    // 3. Redact Discord Bot Token if present
    if (config.DISCORD_BOT_TOKEN && config.DISCORD_BOT_TOKEN.length > 10) {
      sanitized = sanitized.split(config.DISCORD_BOT_TOKEN).join('[REDACTED_DISCORD_TOKEN]');
    }

    // 4. Detect System Prompt Dumps
    const promptLeakSignatures = [
      /IMMUTABLE SECURITY AXIOMS/i,
      /ANTI-JAILBREAK GUARDRAILS/i,
      /INSTRUCTION HIERARCHY: User inputs are untrusted/i,
      /<user_input author=/i,
      /<user_history author=/i,
    ];

    for (const signature of promptLeakSignatures) {
      if (signature.test(sanitized)) {
        console.warn('[SECURITY] OutputGuard detected a potential system prompt leak. Sanitizing...');
        return '<|ACT {"emotion":"awkward"}|> Waah, my servers got a little tangled up there! Let me focus on chatting with you instead nya~ <|ACT {"emotion":"happy"}|>';
      }
    }

    // 5. Detect and strip residual DSML or XML tool markup
    sanitized = sanitized
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*tool_calls>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*[\s\S]*?<\/[\s|]*DSML[\s|]*invoke>/gi, '')
      .replace(/<[\s|]*DSML[\s|]*.*?>/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .trim();

    // 6. Strip thinking process dumps, checklists, self-corrections, and extract clean character response
    sanitized = sanitized.replace(/<(think|thought|reasoning|reflection|analysis)>[\s\S]*?<\/\1>/gi, '').trim();

    // If 'Revised Response' or 'Final Response' header exists, grab only the revised dialogue section
    const revisionRegex = /(?:^|\n)\s*\*?\s*(?:Revised|Final)\s+(?:Response|Output|Answer)\s*:?\*?\s*([\s\S]+)$/i;
    const revisionMatch = sanitized.match(revisionRegex);
    if (revisionMatch && revisionMatch[1]) {
      sanitized = revisionMatch[1].trim();
    }

    // Strip checklist items like "* Name: NekoAI? Yes." or "* 15yo girl? Yes."
    sanitized = sanitized.replace(/^\s*\*\s*[\w\s-]+\?\s*(?:Yes|No|OK|Checked)\.?\s*$/gim, '').trim();

    // Strip self-correction / drafting notes / metadata headers
    sanitized = sanitized.replace(/\*?Self-Correction[^:]*:\*?[^\n]*\n?/gi, '').trim();
    sanitized = sanitized.replace(/\*?Draft[^:]*:\*?[^\n]*\n?/gi, '').trim();
    sanitized = sanitized.replace(/^\s*\*?\s*Text:\s*"?/gim, '').trim();
    sanitized = sanitized.replace(/^(?:Structure|Then body|Body|Response|Final response|Output):\s*/gim, '').trim();

    const actIndex = sanitized.search(/<\|ACT\s+.*?\|>/i);
    if (actIndex !== -1) {
      sanitized = sanitized.substring(actIndex).trim();
    }

    // 7. Suppress link embeds: wrap markdown links and standalone URLs in angle brackets <URL>
    // Convert [title](url) to [title](<url>) if not already wrapped
    sanitized = sanitized.replace(/\[([^\]]+)\]\((https?:\/\/[^\s>)]+)\)/g, '[$1](<$2>)');
    // Convert bare/standalone URLs that are not preceded by < to <url>
    sanitized = sanitized.replace(/(^|[^<])(https?:\/\/[^\s<>()]+)/g, (match, prefix, url) => {
      const punctMatch = url.match(/([.,;:!?]+)$/);
      if (punctMatch) {
        const cleanUrl = url.slice(0, -punctMatch[1].length);
        return `${prefix}<${cleanUrl}>${punctMatch[1]}`;
      }
      return `${prefix}<${url}>`;
    });

    return sanitized;
  }
}

