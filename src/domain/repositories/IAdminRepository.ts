export interface IAdminRepository {
  logAudit(
    userId: unknown,
    action: string,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  listTrackedCompanies(status?: string): Promise<Record<string, unknown>[]>;
  updateTrackedCompanyStatus(id: string, status: string): Promise<Record<string, unknown> | null>;
  getJobCoverageInteractions(since: Date): Promise<Record<string, unknown>>;
  listJobReports(page?: number, limit?: number): Promise<{ reports: unknown[]; total: number }>;
  getPlatformTelemetry(): Promise<Record<string, unknown>>;
  listUsers(page?: number, limit?: number): Promise<{ users: unknown[]; total: number }>;
  findUserById(id: string): Promise<Record<string, unknown> | null>;
  countSuperAdmins(): Promise<number>;
  updateUserById(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  getBillingOverview(since: Date): Promise<Record<string, unknown>>;
  listSubscriptions(limit?: number): Promise<unknown[]>;
  findSubscriptionById(id: string): Promise<Record<string, unknown> | null>;
  markSubscriptionCancelAtPeriodEnd(id: string): Promise<void>;
  listPayments(page?: number, limit?: number): Promise<{ payments: unknown[]; total: number }>;
  findPaymentByProviderPaymentId(paymentId: string): Promise<Record<string, unknown> | null>;
  claimPaymentRefund(
    id: unknown,
    currentStatus: string,
    amountRefundedMinor: number,
  ): Promise<boolean>;
  revertPaymentStatus(id: unknown, fallbackStatus: string): Promise<void>;
  listAuditLogs(page?: number, limit?: number): Promise<{ events: unknown[]; total: number }>;
}
