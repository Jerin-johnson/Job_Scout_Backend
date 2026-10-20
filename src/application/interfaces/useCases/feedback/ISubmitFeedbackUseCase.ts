export interface SubmitFeedbackInput {
  userId?: string;
  category: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface SubmitFeedbackResult {
  id: string;
  createdAt?: Date;
  message: string;
}

export interface ISubmitFeedbackUseCase {
  execute(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult>;
}
