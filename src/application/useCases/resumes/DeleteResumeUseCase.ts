import { injectable, inject } from "tsyringe";
import { IDeleteResumeUseCase } from "../../interfaces/useCases/resumes/IDeleteResumeUseCase.js";
import { IResumeRepository } from "../../../domain/repositories/IResumeRepository.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class DeleteResumeUseCase implements IDeleteResumeUseCase {
  constructor(
    @inject(TOKENS.ResumeRepository)
    private readonly resumeRepository: IResumeRepository,
  ) {}

  async execute(userId: string, resumeId: string): Promise<boolean> {
    return this.resumeRepository.deleteResumeForUser({ userId, resumeId });
  }

  async deleteAllForUser(userId: string): Promise<number> {
    return this.resumeRepository.deleteAllUserResumeData(userId);
  }
}
