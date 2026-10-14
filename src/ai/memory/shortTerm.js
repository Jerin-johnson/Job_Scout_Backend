import { get, set, CacheKeys, TTL } from "../../shared/cache.js";

const inMemorySessions = new Map();

export const shortTermMemory = {
  /**
   * Append a message turn to the session history (keeps last 8 turns)
   */
  async appendTurn(userId, threadId, role, content) {
    const key = CacheKeys.session(userId, threadId);
    let turns = await this.getTurns(userId, threadId);

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
  async getTurns(userId, threadId) {
    const key = CacheKeys.session(userId, threadId);
    const cached = await get(key);
    if (cached) return cached;
    return inMemorySessions.get(key) || [];
  },

  /**
   * Clear session
   */
  async clearSession(userId, threadId) {
    const key = CacheKeys.session(userId, threadId);
    inMemorySessions.delete(key);
  },
};
