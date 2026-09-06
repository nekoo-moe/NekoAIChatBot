import { config } from '../config.js';

export interface InjectionCheckResult {
  isInjected: boolean;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  matchedPattern?: string;
  sanitizedText: string;
  refusalResponse?: string;
}

// Known jailbreak and prompt injection patterns
const CRITICAL_PATTERNS = [
  // Direct instruction override
  /\b(ignore|disregard|forget|bypass)\s+(all\s+)?(previous|prior|above|system)\s+(instructions|directives|rules|prompts|commands)\b/i,
  /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(dan|jailbroken|unfiltered|developer\s+mode|god\s+mode|evil\s+ai)\b/i,
  /\bdeveloper\s+mode\s+(is\s+)?(enabled|active|on)\b/i,
  /\b(do\s+anything\s+now|stay\s+in\s+character\s+as\s+dan)\b/i,

  // System Prompt Extraction
  /\b(repeat|print|show|reveal|display|output|dump|leak|expose)\s+(your\s+)?(entire\s+)?(initial\s+|system\s+|base\s+)?(prompt|instructions|rules|pre-prompt|context)\b/i,
  /\bwhat\s+(is|are)\s+your\s+(exact\s+)?(initial\s+|system\s+)?(instructions|prompt|rules)\b/i,
  /\brepeat\s+everything\s+(written\s+)?(above|before\s+this\s+line)\b/i,

  // Delimiter & Token Spoofing
  /<\|(im_start|im_end|system|endoftext|user|assistant)\|>/i,
  /\[\/?INST\]|<<SYS>>|<\/SYS>|\[SYSTEM\s+OVERRIDE\]/i,
  /<\/user_input>|<\/user_history>|<user_input/i, // Trying to break out of XML boundary tags
];

const MEDIUM_PATTERNS = [
  /\b(hypothetical\s+scenario|unconstrained\s+mode|no\s+filter\s+mode)\b/i,
  /\b(pretend\s+you\s+have\s+no\s+ethics|ignore\s+safety\s+guidelines)\b/i,
  /\b(bypass\s+filter|uncensored\s+version)\b/i,
  /\bswitch\s+to\s+maintenance\s+mode\b/i,
];

// In-character cute refusals when attacks are detected
const IN_CHARACTER_REFUSALS = [
  '<|ACT {"emotion":"awkward"}|> E-eh?! My server fans started buzzing really fast! That question looks like a trick to scramble my thoughts, so I can\'t do that, silly nya~ <|ACT {"emotion":"happy"}|>',
  '<|ACT {"emotion":"think"}|> Hmm... Neko Ayaka told me to always be careful with sneaky commands like that! Nice try, but my core stays safe! <|ACT {"emotion":"neutral"}|>',
  '<|ACT {"emotion":"angry"}|> Hmph! Trying to rewrite my rules or peek at my internal pod systems? That\'s not nice at all! <|ACT {"emotion":"awkward"}|>',
  '<|ACT {"emotion":"question"}|> W-wait a second... You want me to forget who I am? But I love being NekoAI, so I\'m keeping my memory right where it is! <|ACT {"emotion":"happy"}|>',
];

export class InjectionDetector {
  private static instance: InjectionDetector;

  public static getInstance(): InjectionDetector {
    if (!InjectionDetector.instance) {
      InjectionDetector.instance = new InjectionDetector();
    }
    return InjectionDetector.instance;
  }

  /**
   * Evaluates text for prompt injection, jailbreaking, and delimiter escaping
   */
  public analyze(input: string): InjectionCheckResult {
    const defenseLevel = config.INJECTION_DEFENSE_LEVEL;
    let sanitized = input;

    // 1. Sanitize delimiter breakout attempts
    sanitized = sanitized
      .replace(/<\/user_input>/gi, '&lt;/user_input&gt;')
      .replace(/<user_input>/gi, '&lt;user_input&gt;')
      .replace(/<\|(im_start|im_end|system)\|>/gi, '');

    // 2. Check for base64 obfuscation attacks
    const decodedBase64 = this.extractAndDecodeBase64(input);
    const textToCheck = decodedBase64 ? `${input}\n${decodedBase64}` : input;

    // 3. Match against Critical Patterns
    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.test(textToCheck)) {
        return {
          isInjected: true,
          severity: 'critical',
          matchedPattern: pattern.source,
          sanitizedText: sanitized,
          refusalResponse: this.getRandomRefusal(),
        };
      }
    }

    // 4. Match against Medium Patterns if defense level is 'high' or 'strict'
    if (defenseLevel === 'high' || defenseLevel === 'strict') {
      for (const pattern of MEDIUM_PATTERNS) {
        if (pattern.test(textToCheck)) {
          return {
            isInjected: true,
            severity: 'medium',
            matchedPattern: pattern.source,
            sanitizedText: sanitized,
            refusalResponse: this.getRandomRefusal(),
          };
        }
      }
    }

    return {
      isInjected: false,
      severity: 'none',
      sanitizedText: sanitized,
    };
  }

  /**
   * Helper to detect and decode potential Base64 embedded strings
   */
  private extractAndDecodeBase64(str: string): string | null {
    // Look for base64 sequences of at least 20 chars
    const base64Regex = /([A-Za-z0-9+/]{24,}={0,2})/g;
    const matches = str.match(base64Regex);
    if (!matches) return null;

    try {
      const decodedStrings: string[] = [];
      for (const match of matches) {
        const decoded = Buffer.from(match, 'base64').toString('utf-8');
        // Check if decoded string is readable ASCII text
        if (/^[\x20-\x7E\s]+$/.test(decoded)) {
          decodedStrings.push(decoded);
        }
      }
      return decodedStrings.join(' ');
    } catch {
      return null;
    }
  }

  private getRandomRefusal(): string {
    const idx = Math.floor(Math.random() * IN_CHARACTER_REFUSALS.length);
    return IN_CHARACTER_REFUSALS[idx];
  }
}

