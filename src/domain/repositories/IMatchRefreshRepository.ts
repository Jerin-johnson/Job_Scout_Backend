export interface IMatchRefreshRepository {
  getMatchRefresh(userId: string, profileVersion: number): Promise<Record<string, unknown> | null>;
  requestMatchRefresh(
    userId: string,
    profileVersion: number,
    options?: { broaden?: boolean },
  ): Promise<Record<string, unknown> | null>;
  markMatchRefresh(
    attemptId: string,
    updates: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  enqueueMatchRefreshForUser(
    userId: string,
    profileVersion?: number,
  ): Promise<Record<string, unknown> | null>;
}
