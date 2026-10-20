export interface IExportUserDataUseCase {
  execute(userId: string): Promise<Record<string, unknown>>;
}
