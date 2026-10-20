export interface IResumeMatchReportService {
  generateReport(userId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  getReport(userId: string, reportId: string): Promise<Record<string, unknown> | null>;
  updateIgnoredKeywords(
    userId: string,
    reportId: string,
    ignoredKeywords: unknown[],
  ): Promise<Record<string, unknown> | null>;
}
