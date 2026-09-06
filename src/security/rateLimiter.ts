import { config } from '../config.js';

interface RateLimitRecord {
  timestamps: number[];
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: 'user' | 'channel';
}

export class RateLimiter {
  private static instance: RateLimiter;
  private userRecords = new Map<string, RateLimitRecord>();
  private channelRecords = new Map<string, RateLimitRecord>();

  private constructor() {
    // Cleanup stale records every 5 minutes (unref so it doesn't block process exit)
    const timer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  public static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  /**
   * Checks if user and channel are within allowed rate limits
   */
  public checkLimit(userId: string, channelId: string): RateLimitCheckResult {
    const now = Date.now();

    // 1. Check User Limit
    const userWindowMs = config.RATE_LIMIT_USER_WINDOW_SECONDS * 1000;
    const userMax = config.RATE_LIMIT_USER_MAX_REQUESTS;
    const userRecord = this.getOrCreateRecord(this.userRecords, userId);

    userRecord.timestamps = userRecord.timestamps.filter((ts) => now - ts < userWindowMs);

    if (userRecord.timestamps.length >= userMax) {
      const oldest = userRecord.timestamps[0];
      const retryAfter = Math.ceil((userWindowMs - (now - oldest)) / 1000);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, retryAfter),
        reason: 'user',
      };
    }

    // 2. Check Channel Limit
    const channelWindowMs = config.RATE_LIMIT_CHANNEL_WINDOW_SECONDS * 1000;
    const channelMax = config.RATE_LIMIT_CHANNEL_MAX_REQUESTS;
    const channelRecord = this.getOrCreateRecord(this.channelRecords, channelId);

    channelRecord.timestamps = channelRecord.timestamps.filter((ts) => now - ts < channelWindowMs);

    if (channelRecord.timestamps.length >= channelMax) {
      const oldest = channelRecord.timestamps[0];
      const retryAfter = Math.ceil((channelWindowMs - (now - oldest)) / 1000);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, retryAfter),
        reason: 'channel',
      };
    }

    // Record request timestamp
    userRecord.timestamps.push(now);
    channelRecord.timestamps.push(now);

    return { allowed: true };
  }

  private getOrCreateRecord(map: Map<string, RateLimitRecord>, key: string): RateLimitRecord {
    let record = map.get(key);
    if (!record) {
      record = { timestamps: [] };
      map.set(key, record);
    }
    return record;
  }

  private cleanup(): void {
    const now = Date.now();
    const maxWindow = Math.max(config.RATE_LIMIT_USER_WINDOW_SECONDS, config.RATE_LIMIT_CHANNEL_WINDOW_SECONDS) * 1000;

    for (const [key, record] of this.userRecords.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < maxWindow);
      if (record.timestamps.length === 0) {
        this.userRecords.delete(key);
      }
    }

    for (const [key, record] of this.channelRecords.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < maxWindow);
      if (record.timestamps.length === 0) {
        this.channelRecords.delete(key);
      }
    }
  }

  /**
   * Generates a cute in-character cooldown message
   */
  public getCooldownMessage(retryAfterSeconds: number, reason: 'user' | 'channel'): string {
    if (reason === 'user') {
      return `<|ACT {"emotion":"awkward"}|> W-waah! You're talking so fast, my CPU is overheating nya~! Please catch your breath for about **${retryAfterSeconds}s**, okay? <|ACT {"emotion":"happy"}|>`;
    }
    return `<|ACT {"emotion":"surprised"}|> Whoa, this channel is super lively! My server pod needs **${retryAfterSeconds}s** to cool down before taking more questions~ <|ACT {"emotion":"neutral"}|>`;
  }
}
