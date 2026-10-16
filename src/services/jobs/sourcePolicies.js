// Approved source policies. New sources are disabled unless explicitly approved here
// and then enabled in the Mongo source registry.
import { env } from "../../config/env.js";

export const SOURCE_POLICIES = Object.freeze([
  {
    key: "remoteok",
    displayName: "Remote OK",
    adapterModule: "remoteOkAdapter.js",
    approved: true,
    enabled: true,
    termsUrl: "https://remoteok.com/legal",
    attributionText: "Remote OK",
    attributionUrl: "https://remoteok.com/",
    retentionDays: 30,
    staleAfterDays: 14,
    quota: { requestsPerDay: 1, intervalMs: 86400000, timeoutMs: 10000, maxRetries: 2 },
    termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
  },
  {
    key: "remotive",
    displayName: "Remotive",
    adapterModule: "remotiveAdapter.js",
    // The current terms prohibit copying or redistributing listings. Keep disabled
    // until written permission covers the catalog use.
    approved: false,
    enabled: false,
    activationRequirements: ["written_redistribution_permission"],
    activationStatus: "blocked_on_terms",
    termsUrl: "https://remotive.com/terms-of-use",
    attributionText: "Remotive",
    attributionUrl: "https://remotive.com/",
    retentionDays: 14,
    staleAfterDays: 7,
    quota: { requestsPerDay: 4, intervalMs: 21600000, timeoutMs: 10000, maxRetries: 2 },
    termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
  },
  {
    key: "jobicy",
    displayName: "Jobicy",
    adapterModule: "jobicyAdapter.js",
    // Public API access is documented, but the current general terms prohibit
    // storing/re-distributing Jobicy materials without prior written consent.
    approved: false,
    enabled: false,
    activationRequirements: ["written_redistribution_permission"],
    activationStatus: "blocked_on_terms",
    termsUrl: "https://jobicy.com/terms-and-conditions",
    attributionText: "Jobicy",
    attributionUrl: "https://jobicy.com/",
    retentionDays: 14,
    staleAfterDays: 7,
    quota: { requestsPerDay: 24, intervalMs: 3600000, timeoutMs: 15000, maxRetries: 2 },
    termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
  },
  ...["greenhouse", "lever", "ashby"].map((key) => ({
    key,
    displayName: `${key[0].toUpperCase()}${key.slice(1)} company job boards`,
    adapterModule: "publicAtsAdapter.js",
    approved: false,
    enabled: false,
    termsUrl: key === "greenhouse" ? "https://docs.greenhouse.io/job-board" : key === "lever" ? "https://github.com/lever/postings-api" : "https://developers.ashbyhq.com/docs/public-job-posting-api",
    attributionText: key[0].toUpperCase() + key.slice(1),
    attributionUrl: key === "greenhouse" ? "https://www.greenhouse.com/" : key === "lever" ? "https://www.lever.co/" : "https://www.ashbyhq.com/",
    retentionDays: 14,
    staleAfterDays: 2,
    quota: { requestsPerDay: 10, intervalMs: 86400000, timeoutMs: 8000, maxRetries: 1 },
    termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
  })),
  {
    key: "adzuna-india",
    displayName: "Adzuna India",
    adapterModule: "adzunaAdapter.js",
    approved: false,
    enabled: false,
    termsUrl: "https://developer.adzuna.com/docs/terms_of_service",
    attributionText: "Adzuna",
    attributionUrl: "https://www.adzuna.in/",
    retentionDays: 1,
    staleAfterDays: 1,
    quota: { requestsPerDay: 250, intervalMs: 86400000, timeoutMs: 8000, maxRetries: 1, limits: { perMinute: 25, perDay: 250, perWeek: 1000, perMonth: 2500 } },
    activationRequirements: ["commercial_license_reference", "attribution_badge_verified", "storage_and_display_terms_reviewed"],
    activationStatus: "blocked_on_license",
    termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
  },
].map((policy) => ({
  ...policy,
  termsReference: policy.termsUrl,
  retentionRule: policy.retentionRule || `Delete after ${policy.retentionDays} days or earlier when source marks inactive.`,
  quotaPolicy: policy.quotaPolicy || `${policy.quota.requestsPerDay} requests per day; minimum interval ${policy.quota.intervalMs}ms.`,
})));

export function isSourcePolicyComplete(policy) {
  return Boolean(
    policy?.termsUrl && policy?.termsReference && policy?.attributionText && policy?.attributionUrl && /^[A-Za-z0-9_-]+Adapter\.js$/.test(policy?.adapterModule || "") &&
    policy?.retentionRule && policy?.quotaPolicy &&
    Number.isFinite(policy?.retentionDays) && policy.retentionDays > 0 &&
    Number.isFinite(policy?.staleAfterDays) && policy.staleAfterDays > 0 &&
    Number.isFinite(policy?.quota?.requestsPerDay) && policy.quota.requestsPerDay > 0 &&
    policy?.termsVerifiedAt,
  );
}

const SOURCE_ENV_FLAGS = Object.freeze({
  greenhouse: "ENABLE_GREENHOUSE_INGESTION",
  lever: "ENABLE_LEVER_INGESTION",
  ashby: "ENABLE_ASHBY_INGESTION",
});

export function isSourceEnabledByEnvironment(sourceKey, config = env) {
  const flag = SOURCE_ENV_FLAGS[sourceKey];
  return flag ? config[flag] === true : true;
}

// Adzuna's terms require a licensed commercial arrangement/strict display attribution;
// ordinary admin approval is intentionally insufficient to activate it.
export function isSourceActivationAllowed(source) {
  if (["remotive", "jobicy"].includes(source?.key)) return Boolean(source?.writtenRedistributionPermissionReference);
  if (source?.key !== "adzuna-india") return true;
  return Boolean(source?.commercialLicenseReference && source?.attributionBadgeVerified && source?.storageDisplayTermsReviewed);
}
