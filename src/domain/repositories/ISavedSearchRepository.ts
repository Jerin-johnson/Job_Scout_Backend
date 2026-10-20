export interface ISavedSearchRepository {
  createSavedSearch(
    userId: string,
    input: Record<string, unknown>,
    userPlan?: string,
  ): Promise<Record<string, unknown>>;
  listSavedSearches(userId: string, plan?: string): Promise<Record<string, unknown>>;
  updateSavedSearch(
    userId: string,
    searchId: string,
    updates: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  deleteSavedSearch(userId: string, searchId: string): Promise<boolean>;
  unsubscribeSavedSearchByToken(token: string): Promise<boolean>;
  deleteAllForUser(userId: string): Promise<number>;
  exportForUser(userId: string): Promise<Record<string, unknown>[]>;
}
