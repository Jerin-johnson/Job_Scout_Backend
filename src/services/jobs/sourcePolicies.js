// Approved source policies. New sources are disabled unless explicitly approved here
// and then enabled in the Mongo source registry.
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
    approved: true,
    enabled: true,
    termsUrl: "https://github.com/remotive-com/remote-jobs-api",
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
    approved: true,
    enabled: true,
    termsUrl: "https://github.com/Jobicy/remote-jobs-api",
    attributionText: "Jobicy",
    attributionUrl: "https://jobicy.com/",
    retentionDays: 14,
    staleAfterDays: 7,
    quota: { requestsPerDay: 24, intervalMs: 3600000, timeoutMs: 15000, maxRetries: 2 },
    termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
  },
]);

export function isSourcePolicyComplete(policy) {
  return Boolean(
    policy?.termsUrl && policy?.attributionText && policy?.attributionUrl && /^[A-Za-z0-9_-]+Adapter\.js$/.test(policy?.adapterModule || "") &&
    Number.isFinite(policy?.retentionDays) && policy.retentionDays > 0 &&
    Number.isFinite(policy?.staleAfterDays) && policy.staleAfterDays > 0 &&
    Number.isFinite(policy?.quota?.requestsPerDay) && policy.quota.requestsPerDay > 0 &&
    policy?.termsVerifiedAt,
  );
}
