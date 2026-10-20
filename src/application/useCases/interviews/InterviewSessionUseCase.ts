import { injectable, inject } from "tsyringe";
import { IInterviewSessionUseCase } from "../../interfaces/useCases/interviews/IInterviewSessionUseCase.js";
import { IInterviewSessionRepository } from "../../../domain/repositories/IInterviewSessionRepository.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class InterviewSessionUseCase implements IInterviewSessionUseCase {
  constructor(
    @inject(TOKENS.InterviewSessionRepository)
    private readonly sessionRepository: IInterviewSessionRepository,
  ) {}

  async startSession(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.sessionRepository.startSession(userId, data);
  }

  async submitAnswer(
    userId: string,
    sessionId: string,
    answerText: string,
  ): Promise<Record<string, unknown>> {
    return this.sessionRepository.submitAnswer(userId, sessionId, answerText);
  }

  async endSession(userId: string, sessionId: string): Promise<Record<string, unknown>> {
    return this.sessionRepository.endSession(userId, sessionId);
  }

  async getSessionReport(
    userId: string,
    sessionId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.sessionRepository.getSessionReport(userId, sessionId);
  }
}
