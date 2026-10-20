export interface IResumeRepository {
  deleteResumeForUser(options: { resumeId: string; userId: string }): Promise<boolean>;
  deleteAllUserResumeData(userId: string): Promise<number>;
}
