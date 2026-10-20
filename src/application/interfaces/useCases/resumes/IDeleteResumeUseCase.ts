export interface IDeleteResumeUseCase {
  execute(userId: string, resumeId: string): Promise<boolean>;
}
