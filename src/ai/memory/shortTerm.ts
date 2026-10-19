import { get, set, CacheKeys, TTL } from "../../shared/cache.js";

export interface ShortTermTurn {
  role: string;
  content: string;
  timestamp: string;
}

const inMemorySessions = new Map<string, ShortTermTurn[]>();

export const shortTermMemory = {
  /**
   * Append a message turn to the session history (keeps last 8 turns)
   */
  async appendTurn(
    userId: string | unknown,
    threadId: string | unknown,
    role: string,
    content: string,
  ): Promise<ShortTermTurn[]> {
    const uid = String(userId || "");
    const tid = String(threadId || "");
    const key = CacheKeys.session(uid, tid);
    let turns = await this.getTurns(uid, tid);

    turns.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    // Keep at most 8 turns in active Redis session
    if (turns.length > 8) {
      turns = turns.slice(-8);
    }

    await set(key, turns, TTL.SESSION);
    inMemorySessions.set(key, turns);
    return turns;
  },

  /**
   * Get all active session turns
   */
  async getTurns(userId: string | unknown, threadId: string | unknown): Promise<ShortTermTurn[]> {
    const uid = String(userId || "");
    const tid = String(threadId || "");
    const key = CacheKeys.session(uid, tid);
    const cached = await get<ShortTermTurn[]>(key);
    if (cached) return cached;
    return inMemorySessions.get(key) || [];
  },

  /**
   * Clear session
   */
  async clearSession(userId: string | unknown, threadId: string | unknown): Promise<void> {
    const uid = String(userId || "");
    const tid = String(threadId || "");
    const key = CacheKeys.session(uid, tid);
    inMemorySessions.delete(key);
  },
};
