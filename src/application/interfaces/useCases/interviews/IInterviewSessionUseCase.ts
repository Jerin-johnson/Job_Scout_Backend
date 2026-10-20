export interface IInterviewSessionUseCase {
  startSession(userId: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  submitAnswer(
    userId: string,
    sessionId: string,
    answerText: string,
  ): Promise<Record<string, unknown>>;
  endSession(userId: string, sessionId: string): Promise<Record<string, unknown>>;
  getSessionReport(userId: string, sessionId: string): Promise<Record<string, unknown> | null>;
}
