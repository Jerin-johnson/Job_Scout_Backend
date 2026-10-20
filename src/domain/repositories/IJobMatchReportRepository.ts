export interface IJobMatchReportRepository {
  findReportById(reportId: string, userId: string): Promise<Record<string, unknown> | null>;
  findReportByResumeAndJob(
    userId: string,
    resumeId: string,
    jobHash: string,
  ): Promise<Record<string, unknown> | null>;
  saveReport(reportData: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateIgnoredKeywords(
    reportId: string,
    userId: string,
    keywords: unknown[],
    scoreResult: unknown,
  ): Promise<Record<string, unknown> | null>;
  deleteByUserId(userId: string): Promise<number>;
  deleteByResumeId(userId: string, resumeId: unknown): Promise<number>;
}
