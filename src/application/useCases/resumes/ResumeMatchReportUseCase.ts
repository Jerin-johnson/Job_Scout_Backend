import { injectable, inject } from "tsyringe";
import { IResumeMatchReportUseCase } from "../../interfaces/useCases/resumes/IResumeMatchReportUseCase.js";
import { IResumeMatchReportService } from "../../../domain/repositories/IResumeMatchReportService.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class ResumeMatchReportUseCase implements IResumeMatchReportUseCase {
  constructor(
    @inject(TOKENS.ResumeMatchReportService)
    private readonly reportService: IResumeMatchReportService,
  ) {}

  async generateReport(
    userId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.reportService.generateReport(userId, input);
  }

  async getReport(userId: string, reportId: string): Promise<Record<string, unknown> | null> {
    return this.reportService.getReport(userId, reportId);
  }

  async updateIgnoredKeywords(
    userId: string,
    reportId: string,
    ignoredKeywords: unknown[],
  ): Promise<Record<string, unknown> | null> {
    return this.reportService.updateIgnoredKeywords(userId, reportId, ignoredKeywords);
  }
}
