export interface IDeleteUserAccountUseCase {
  execute(userId: string): Promise<{ message: string; deletedAt: string }>;
}
