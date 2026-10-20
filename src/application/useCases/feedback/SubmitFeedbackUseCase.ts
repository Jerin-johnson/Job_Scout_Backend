import { injectable, inject } from "tsyringe";
import {
  ISubmitFeedbackUseCase,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
} from "../../interfaces/useCases/feedback/ISubmitFeedbackUseCase.js";
import { IFeedbackRepository } from "../../../domain/repositories/IFeedbackRepository.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class SubmitFeedbackUseCase implements ISubmitFeedbackUseCase {
  constructor(
    @inject(TOKENS.FeedbackRepository)
    private readonly feedbackRepo: IFeedbackRepository,
  ) {}

  async execute(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
    const { userId, ...rest } = input;
    return this.feedbackRepo.createFeedback(userId, rest);
  }
}
