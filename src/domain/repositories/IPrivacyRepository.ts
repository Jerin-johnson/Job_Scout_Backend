export interface IPrivacyRepository {
  exportUserData(userId: string): Promise<Record<string, unknown>>;
  deleteUserAccount(userId: string): Promise<{ message: string; deletedAt: string }>;
}
