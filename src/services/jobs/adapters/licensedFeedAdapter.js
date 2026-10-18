import { BaseJobAdapter } from "./baseAdapter.js";

export class LicensedFeedAdapter extends BaseJobAdapter {
  constructor({ key, displayName, licenseReference, attributionText, attributionUrl, retentionDays, quota, monthlyCreditBudget, requestCredits = 1, provider, reserveCredits, isEnabled = () => false, ...options } = {}) {
    super({ key, displayName, capabilities: { atsNativeOnly: true, conditionalFetch: true, cursors: true }, ...options });
    if (!licenseReference || !attributionText || !attributionUrl || !Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error("Licensed feed requires a license reference, attribution, and positive retention period.");
    }
    if (!Number.isFinite(monthlyCreditBudget) || monthlyCreditBudget < 1 || !Number.isFinite(requestCredits) || requestCredits < 1) {
      throw new Error("Licensed feed requires a finite positive monthly credit budget and request cost.");
    }
    if (!quota || !Number.isFinite(quota.requestsPerDay) || quota.requestsPerDay < 1) throw new Error("Licensed feed requires a positive request quota.");
    if (typeof provider?.fetchPage !== "function" || typeof reserveCredits !== "function" || typeof isEnabled !== "function") {
      throw new Error("Licensed feed needs a provider, durable credit reservation, and kill-switch callback.");
    }
    Object.assign(this, { licenseReference, attributionText, attributionUrl, retentionDays, quota: Object.freeze({ ...quota }), monthlyCreditBudget, requestCredits, provider, reserveCredits, isEnabled });
  }

  async fetchPage({ cursor = null, filters = {} } = {}) {
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
