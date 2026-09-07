export interface ConversationMessage {
  role: 'user' | 'assistant';
  authorName?: string;
  content: string;
  imageUrls?: string[];
  timestamp: number;
}

export interface ConversationSession {
  channelId: string;
  messages: ConversationMessage[];
  lastActive: number;
}

export class ConversationManager {
  private static instance: ConversationManager;
  private sessions: Map<string, ConversationSession> = new Map();

  // Maximum number of message turns to retain per conversation (e.g. 6 user + 6 assistant)
  private readonly maxTurns: number = 14;

  // Session Time-To-Live: 30 minutes of inactivity before memory resets
  private readonly ttlMs: number = 30 * 60 * 1000;

  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // Periodically clean up inactive sessions every 10 minutes
    this.cleanupTimer = setInterval(() => {
      this.cleanExpiredSessions();
    }, 10 * 60 * 1000);
    if (this.cleanupTimer && this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  public static getInstance(): ConversationManager {
    if (!ConversationManager.instance) {
      ConversationManager.instance = new ConversationManager();
    }
    return ConversationManager.instance;
  }

  /**
   * Retrieves active history for a given channel or thread
   */
  public getHistory(channelId: string): ConversationMessage[] {
    const session = this.sessions.get(channelId);
    if (!session) return [];

    // Check if session has expired
    if (Date.now() - session.lastActive > this.ttlMs) {
      this.sessions.delete(channelId);
      return [];
    }

    return [...session.messages];
  }

  /**
   * Adds a message to the channel's conversation history
   */
  public addMessage(
    channelId: string,
    message: Omit<ConversationMessage, 'timestamp'> & { timestamp?: number }
  ): void {
    let session = this.sessions.get(channelId);
    const now = Date.now();

    if (!session || now - session.lastActive > this.ttlMs) {
      session = {
        channelId,
        messages: [],
        lastActive: now,
      };
      this.sessions.set(channelId, session);
    }

    session.messages.push({
      role: message.role,
      authorName: message.authorName,
      content: message.content,
      imageUrls: message.imageUrls,
      timestamp: message.timestamp || now,
    });

    // Sliding window: prune oldest messages if exceeding limit
    if (session.messages.length > this.maxTurns) {
      session.messages = session.messages.slice(-this.maxTurns);
    }

    session.lastActive = now;
  }

  /**
   * Explicitly clears conversation memory for a channel (e.g. via !reset)
   */
  public clear(channelId: string): boolean {
    return this.sessions.delete(channelId);
  }

  /**
   * Prunes sessions that have been idle past the TTL
   */
  public cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [channelId, session] of this.sessions.entries()) {
      if (now - session.lastActive > this.ttlMs) {
        this.sessions.delete(channelId);
      }
    }
  }

  /**
   * Returns stats for diagnostic or logging purposes
   */
  public getStats(): { activeSessionsCount: number } {
    return {
      activeSessionsCount: this.sessions.size,
    };
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }
}
