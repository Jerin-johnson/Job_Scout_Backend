export interface IUsageEventRepository {
  createEvent(eventData: Record<string, unknown>): Promise<unknown>;
  deleteByUserId(userId: string): Promise<number>;
}
