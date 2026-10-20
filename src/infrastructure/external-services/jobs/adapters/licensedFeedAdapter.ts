import { BaseJobAdapter, BaseJobAdapterOptions } from "./baseAdapter.js";

export interface LicensedFeedQuota {
  requestsPerDay: number;
  [key: string]: unknown;
}

export interface CreditReservationResult {
  accepted: boolean;
  [key: string]: unknown;
}

export interface LicensedFeedProvider {
  fetchPage: (options: Record<string, unknown>) => Promise<{
    jobs: Array<{ sourceType?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  }>;
}

export interface LicensedFeedAdapterOptions extends BaseJobAdapterOptions {
  licenseReference?: string;
  attributionText?: string;
  attributionUrl?: string;
  retentionDays?: number;
  quota?: LicensedFeedQuota;
  monthlyCreditBudget?: number;
  requestCredits?: number;
  provider?: LicensedFeedProvider;
  reserveCredits?: (params: {
    source: string;
    credits: number;
    monthlyCreditBudget: number;
    idempotencyKey: string;
  }) => Promise<CreditReservationResult>;
  isEnabled?: () => boolean;
}

export class LicensedFeedAdapter extends BaseJobAdapter {
  licenseReference: string;
  attributionText: string;
  attributionUrl: string;
  retentionDays: number;
  quota: Readonly<LicensedFeedQuota>;
  monthlyCreditBudget: number;
  requestCredits: number;
  provider: LicensedFeedProvider;
  reserveCredits: (params: {
    source: string;
    credits: number;
    monthlyCreditBudget: number;
    idempotencyKey: string;
  }) => Promise<CreditReservationResult>;
  isEnabled: () => boolean;

  constructor({
    key,
    displayName,
    licenseReference,
    attributionText,
    attributionUrl,
    retentionDays = 90,
    quota,
    monthlyCreditBudget,
    requestCredits = 1,
    provider,
    reserveCredits,
    isEnabled = () => false,
    ...options
  }: LicensedFeedAdapterOptions = {}) {
    super({
      key,
      displayName,
      capabilities: { atsNativeOnly: true, conditionalFetch: true, cursors: true },
      ...options,
    });
    if (
      !licenseReference ||
      !attributionText ||
      !attributionUrl ||
      !Number.isInteger(retentionDays) ||
      retentionDays < 1
    ) {
      throw new Error(
        "Licensed feed requires a license reference, attribution, and positive retention period.",
      );
    }
    if (
      !monthlyCreditBudget ||
      !Number.isFinite(monthlyCreditBudget) ||
      monthlyCreditBudget < 1 ||
      !Number.isFinite(requestCredits) ||
      requestCredits < 1
    ) {
      throw new Error(
        "Licensed feed requires a finite positive monthly credit budget and request cost.",
      );
    }
    if (!quota || !Number.isFinite(quota.requestsPerDay) || quota.requestsPerDay < 1) {
      throw new Error("Licensed feed requires a positive request quota.");
    }
    if (
      typeof provider?.fetchPage !== "function" ||
      typeof reserveCredits !== "function" ||
      typeof isEnabled !== "function"
    ) {
      throw new Error(
        "Licensed feed needs a provider, durable credit reservation, and kill-switch callback.",
      );
    }

    this.licenseReference = licenseReference;
    this.attributionText = attributionText;
    this.attributionUrl = attributionUrl;
    this.retentionDays = retentionDays;
    this.quota = Object.freeze({ ...quota });
    this.monthlyCreditBudget = monthlyCreditBudget;
    this.requestCredits = requestCredits;
    this.provider = provider;
    this.reserveCredits = reserveCredits;
    this.isEnabled = isEnabled;
  }

  async fetchPage({
    cursor = null,
    filters = {},
  }: {
    cursor?: string | null;
    filters?: Record<string, unknown>;
  } = {}): Promise<unknown> {
    if (!this.isEnabled()) throw new Error("Licensed feed kill switch is off.");
    const reservation = await this.reserveCredits({
      source: this.name,
      credits: this.requestCredits,
      monthlyCreditBudget: this.monthlyCreditBudget,
      idempotencyKey: String(cursor || "initial").slice(0, 160),
    });
    if (!reservation?.accepted) throw new Error("Licensed feed credit budget is exhausted.");
    const result = await this.provider.fetchPage({
      cursor,
      filters,
      atsNativeOnly: true,
      requestQuota: this.quota,
      maxRetries: this.maxRetries,
      timeoutMs: this.timeoutMs,
    });
    if (!Array.isArray(result?.jobs) || result.jobs.some((job) => job.sourceType !== "ats")) {
      throw new Error("Licensed feed violated the required ATS-native-only source filter.");
    }
    return result;
  }
}

export default LicensedFeedAdapter;
