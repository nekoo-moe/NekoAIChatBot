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

    // 6. Strip prompt echo at start (e.g. "[<emotion_name>] . Use cute expressions...")
    sanitized = sanitized.replace(/^\[?<emotion_name>\]?[^\n]*(?:\r?\n)?/gi, '');
    sanitized = sanitized.replace(/^.*?Use cute expressions like[^\n]*(?:\r?\n)?/gim, '');

    // 7. Strip thinking process dumps, checklists, self-corrections, and extract clean character response
    sanitized = sanitized.replace(/<(think|thought|reasoning|reflection|analysis)>[\s\S]*?<\/\1>/gi, '').trim();

    // If 'Revised Response' or 'Final Response' header exists, grab only the revised dialogue section
    const revisionRegex = /(?:^|\n)\s*\*?\s*(?:Revised|Final)\s+(?:Response|Output|Answer|Version)\s*:?\*?\s*([\s\S]+)$/i;
    const revisionMatch = sanitized.match(revisionRegex);
    if (revisionMatch && revisionMatch[1]) {
      sanitized = revisionMatch[1].trim();
    }

    // Strip markdown code blocks containing checklists, planning, or prompt verification
    sanitized = sanitized.replace(/```(?:markdown|text|json|yaml)?\s*[\s\S]*?```/gi, (match) => {
      if (/(?:ACT|DELAY|CALL|persona|instruction|identity|token|emotion|greeting|flavor|style|\?|Yes|No|Not needed)/i.test(match)) {
        return '';
      }
      return match;
    });

    // Strip planning bullet points (e.g. * Emotion:, * Greeting:, * Character flavor:, * Vietnamese style:, * Creator:)
    sanitized = sanitized.replace(
      /^\s*[\*\-•]\s*\*?(?:Emotion|Greeting|Character|Vietnamese|Creator|No checklists|Actually|Revised|Draft|Note|Plan|Thought|Identity|Tone|Language|Style|Reasoning|Persona|Checklist)\b[^\n]*(?:\r?\n)?/gim,
      ''
    );

    // Strip QA checklists / rule verifications:
    // Pattern A: Bullets with question and answer
    sanitized = sanitized.replace(
      /^\s*[\*\-•]\s+.*?\?\s*(?:Yes|No|Not needed|OK|Checked|True|False|NekoAI|Vietnamese|Cute|Anime girl|Pass|Done|Pending|N\/A|None)[^\n]*(?:\r?\n)?/gim,
      ''
    );
    // Pattern B: Bullets checking rules without question mark, e.g. "* ACT token: Yes", "* Persona: Maintained"
    sanitized = sanitized.replace(
      /^\s*[\*\-•]\s+[\w\s`'/-]+:\s*(?:Yes|No|Not needed|OK|Checked|True|False|Done|Pass|NekoAI|Cute)[^\n]*(?:\r?\n)?/gim,
      ''
    );
    // Pattern C: Persona/rule assessment bullets
    sanitized = sanitized.replace(
      /^\s*[\*\-•]\s+(?:Start with|Use|Maintain|Language|Tone|Identity|Persona|Token|ACT|DELAY|CALL)\b[^\n]+(?:\r?\n)?/gim,
      ''
    );

    // Strip italicized internal reflections like "*Actually, let's make it even more natural.*"
    sanitized = sanitized.replace(/^\s*\*+[A-Za-z\s,'.!/-]+\*+\s*(?:\r?\n)?/gm, '');

    // Strip stray bullets on empty lines (e.g. "*" or "* *")
    sanitized = sanitized.replace(/^\s*[\*\-•]+\s*$/gm, '');

    // Strip self-correction / drafting notes / metadata headers
    sanitized = sanitized.replace(/\*?Self-Correction[^:]*:\*?[^\n]*(?:\r?\n)?/gi, '');
    sanitized = sanitized.replace(/\*?Draft[^:]*:\*?[^\n]*\n?/gi, '');
    sanitized = sanitized.replace(/^\s*\*?\s*Text:\s*"?/gim, '');
    sanitized = sanitized.replace(/^(?:Structure|Then body|Body|Response|Final response|Output):\s*/gim, '');

    // Strip isolated markdown break dots/backticks
    sanitized = sanitized.replace(/^\s*[\.`]\s*$/gm, '');

    // Strip blockquotes that start with ACT or quote dialogue
    sanitized = sanitized.replace(/^>\s*<\|ACT[\s\S]*?(?=(?:\r?\n[^\r\n>])|$)/gim, '');
    sanitized = sanitized.replace(/^>\s*✨\s*\*?\[[\s\S]*?(?=(?:\r?\n[^\r\n>])|$)/gim, '');

    // Deduplicate consecutive identical lines
    const lines = sanitized.split(/\r?\n/);
    const dedupedLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = dedupedLines[dedupedLines.length - 1];
      if (line.trim().length > 10 && prevLine && line.trim() === prevLine.trim()) {
        continue;
      }
      dedupedLines.push(line);
    }
    sanitized = dedupedLines.join('\n');

    // Deduplicate repeated blocks / paragraphs
    let blocks = sanitized.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
    const seenBlocks = new Set<string>();
    const uniqueBlocks: string[] = [];

    for (const block of blocks) {
      const normalized = block
        .replace(/<\|ACT\s+.*?\|>/gi, '')
        .replace(/^[>\s*-]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      if (normalized.length > 5 && seenBlocks.has(normalized)) {
        continue;
      }
      if (normalized.length > 5) {
        seenBlocks.add(normalized);
      }
      uniqueBlocks.push(block);
    }

    blocks = uniqueBlocks;

    // Discard earlier drafts if a later revision with the same opening greeting exists
    if (blocks.length > 1) {
      const finalBlocks: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const currentBlock = blocks[i];
        const currentPrefix = currentBlock
          .replace(/<\|ACT\s+.*?\|>/gi, '')
          .replace(/^[>\s*-]+/, '')
          .trim()
          .substring(0, 25)
          .toLowerCase();

        let hasLaterAlternative = false;
        for (let j = i + 1; j < blocks.length; j++) {
          const nextPrefix = blocks[j]
            .replace(/<\|ACT\s+.*?\|>/gi, '')
            .replace(/^[>\s*-]+/, '')
            .trim()
            .substring(0, 25)
            .toLowerCase();
          if (currentPrefix.length >= 10 && nextPrefix.length >= 10 && currentPrefix === nextPrefix) {
            hasLaterAlternative = true;
            break;
          }
        }

        if (!hasLaterAlternative) {
          finalBlocks.push(currentBlock);
        }
      }
      blocks = finalBlocks;
    }

    sanitized = blocks.join('\n\n').trim();

    // Deduplicate exact duplicate back-to-back repeat
    const halfLen = Math.floor(sanitized.length / 2);
    const firstHalf = sanitized.slice(0, halfLen).trim();
    const secondHalf = sanitized.slice(halfLen).trim();
    if (firstHalf.length > 20 && firstHalf === secondHalf) {
      sanitized = firstHalf;
    }

    const actIndex = sanitized.search(/(?:<\|ACT\s+.*?\|>|✨\s*\*?\[[A-Za-z]+\]\*?)/i);
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

