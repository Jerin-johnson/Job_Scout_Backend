export interface ITrackedCompanyRepository {
  requestTracking(careersUrl: string, userId: string): Promise<Record<string, unknown>>;
  verifyBoard(platform: string, slug: string): Promise<boolean>;
}
