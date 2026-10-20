export interface LoadedJobDetails {
  job: Record<string, unknown> | null;
  canonicalJob: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  alsoListedOn: Array<{ source?: string; url?: string }>;
}

export interface IJobRepository {
  getHiddenJobIds(userId: string): Promise<string[]>;
  hideJob(userId: string, jobId: unknown): Promise<void>;
  findActiveJobById(id: string): Promise<Record<string, unknown> | null>;
  loadJobDetails(id: string): Promise<LoadedJobDetails | null>;
  findSimilarJobs(jobId: unknown, sourceBoard: unknown): Promise<Record<string, unknown>[]>;
  findJobById(id: string): Promise<{ _id: unknown } | null>;
  incrementJobClicks(id: unknown): Promise<void>;
  incrementJobReports(id: unknown, reason: string): Promise<void>;
  findJobSummary(id: unknown): Promise<Record<string, unknown> | null>;
  findActiveCatalogSample(): Promise<Record<string, unknown>[]>;
  countVectorsForJobs(jobIds: unknown[]): Promise<number>;
}
