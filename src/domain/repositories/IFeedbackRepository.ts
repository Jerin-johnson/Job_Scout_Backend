export interface FeedbackRecordResult {
  id: string;
  createdAt?: Date;
  message: string;
}

export interface IFeedbackRepository {
  createFeedback(
    userId: string | undefined,
    input: Record<string, unknown>,
  ): Promise<FeedbackRecordResult>;
}
