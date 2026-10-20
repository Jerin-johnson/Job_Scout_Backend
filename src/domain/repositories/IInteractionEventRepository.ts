export interface IInteractionEventRepository {
  record(eventData: Record<string, unknown>): Promise<unknown>;
  deleteByActorKey(actorKey: string): Promise<number>;
  deleteByUserId(userId: string): Promise<number>;
}
