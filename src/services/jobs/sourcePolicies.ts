// Approved source policies. New sources are disabled unless explicitly approved here
// and then enabled in the Mongo source registry.
import { env } from "../../config/env.js";

export interface SourceQuotaConfig {
  requestsPerDay: number;
  intervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  limits?: {
    perMinute?: number;
    perDay?: number;
    perWeek?: number;
    perMonth?: number;
  };
}

export interface SourcePolicyDefinition {
  key: string;
  displayName: string;
  adapterModule: string;
  approved: boolean;
  enabled: boolean;
  termsUrl: string;
  attributionText: string;
  attributionUrl: string;
  retentionDays: number;
  staleAfterDays: number;
  quota: SourceQuotaConfig;
  termsVerifiedAt: Date;
  termsReference?: string;
  retentionRule?: string;
  quotaPolicy?: string;
  activationRequirements?: string[];
  activationStatus?: string;
}

export interface SourcePolicy extends SourcePolicyDefinition {
  termsReference: string;
  retentionRule: string;
  quotaPolicy: string;
}

const BASE_POLICIES: SourcePolicyDefinition[] = [
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
    approved: true,
    enabled: false,
    activationStatus: "approved_api_terms_default_disabled",
    termsUrl: "https://jobicy.com/jobs-rss-feed",
    attributionText: "Jobicy",
    attributionUrl: "https://jobicy.com/",
    retentionDays: 7,
    staleAfterDays: 7,
    quota: { requestsPerDay: 24, intervalMs: 3600000, timeoutMs: 15000, maxRetries: 2 },
    retentionRule:
      "The feed returns listings published within seven days. Do not close a listing only because it leaves that window; use the public status endpoint. Close explicit closed results immediately; hide unknown results and recheck. Active status confirmation allows a seven-day local freshness window before another check.",
    quotaPolicy:
      "Public keyless API. Keep a full sync pass at least one hour apart; a few passes per day are normally enough. Pages in one cursor pass are sequential, up to 200 jobs each. The implementation conservatively caps request starts at 24 per day; this is our quota guard, not a published daily quota.",
    termsVerifiedAt: new Date("2026-10-17T00:00:00.000Z"),
  },
  ...["greenhouse", "lever", "ashby"].map((key) => ({
    key,
    displayName: `${key[0].toUpperCase()}${key.slice(1)} company job boards`,
    adapterModule: "publicAtsAdapter.js",
    approved: false,
    enabled: false,
    termsUrl:
      key === "greenhouse"
        ? "https://docs.greenhouse.io/job-board"
        : key === "lever"
          ? "https://github.com/lever/postings-api"
          : "https://developers.ashbyhq.com/docs/public-job-posting-api",
    attributionText: key[0].toUpperCase() + key.slice(1),
    attributionUrl:
      key === "greenhouse"
        ? "https://www.greenhouse.com/"
        : key === "lever"
          ? "https://www.lever.co/"
          : "https://www.ashbyhq.com/",
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
    quota: {
      requestsPerDay: 250,
      intervalMs: 86400000,
      timeoutMs: 8000,
      maxRetries: 1,
      limits: { perMinute: 25, perDay: 250, perWeek: 1000, perMonth: 2500 },
    },
    activationRequirements: [
      "commercial_license_reference",
      "attribution_badge_verified",
      "storage_and_display_terms_reviewed",
    ],
    activationStatus: "blocked_on_license",
    termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
  },
  {
    key: "jobstream-se",
    displayName: "Sweden JobStream",
    adapterModule: "jobStreamAdapter.js",
    approved: false,
    enabled: false,
    activationStatus: "disabled_pending_feed_configuration",
    termsUrl: "https://data.arbetsformedlingen.se/dataservice/jobstream/",
    attributionText: "Swedish Public Employment Service (JobTech) open data",
    attributionUrl: "https://data.arbetsformedlingen.se/",
    retentionDays: 30,
    staleAfterDays: 7,
    quota: { requestsPerDay: 4, intervalMs: 21600000, timeoutMs: 30000, maxRetries: 0 },
    retentionRule:
      "Keep only currently active ads; close an ad immediately on an unpublished/deleted change event and expire active records after 30 days without refresh.",
    quotaPolicy:
      "Snapshot once for initial sync; then use bounded incremental change windows no more than four times per day. Stream JSONL; do not download or buffer the full snapshot in memory.",
    termsVerifiedAt: new Date("2026-10-17T00:00:00.000Z"),
  },
  {
    key: "nav-no",
    displayName: "Norway NAV / Arbeidsplassen",
    adapterModule: "navAdapter.js",
    approved: false,
    enabled: false,
    activationStatus: "disabled_pending_token_and_feed_configuration",
    termsUrl: "https://arbeidsplassen.nav.no/vilkar-api",
    attributionText: "Arbeidsplassen NAV",
    attributionUrl: "https://arbeidsplassen.nav.no/",
    retentionDays: 1,
    staleAfterDays: 1,
    quota: { requestsPerDay: 24, intervalMs: 3600000, timeoutMs: 15000, maxRetries: 1 },
    retentionRule:
      "Never retain inactive ads; process the inactive event as a delete/close immediately. Active ads expire after one day unless refreshed.",
    quotaPolicy:
      "Local fixture-only validation until an operator configures and approves the official feed token and feed URL; then poll no more than hourly within the published feed limits.",
    activationRequirements: ["local_feed_credentials", "terms_reuse_confirmed"],
    termsVerifiedAt: new Date("2026-10-17T00:00:00.000Z"),
  },
  {
    key: "france-travail",
    displayName: "France Travail",
    adapterModule: "franceTravailAdapter.js",
    approved: false,
    enabled: false,
    activationStatus: "disabled_pending_oauth_and_reuse_license_review",
    termsUrl:
      "https://www.francetravail.fr/informations/informations-legales-et-conditio/conditions-generales-dutilisatio.html",
    attributionText: "France Travail",
    attributionUrl: "https://www.francetravail.fr/",
    retentionDays: 1,
    staleAfterDays: 1,
    quota: { requestsPerDay: 24, intervalMs: 3600000, timeoutMs: 12000, maxRetries: 1 },
    retentionRule:
      "Index active offers only, strip contact details, and remove or close offers immediately when no longer active; expire after one day unless refreshed.",
    quotaPolicy:
      "Fixture-only until OAuth credentials and a reuse license that permits storage and display are confirmed; then operate within the API quota and page limits assigned to the application.",
    activationRequirements: [
      "oauth_credentials",
      "reuse_license_reference",
      "terms_storage_display_reviewed",
    ],
    termsVerifiedAt: new Date("2026-10-17T00:00:00.000Z"),
  },
];

export const SOURCE_POLICIES: readonly SourcePolicy[] = Object.freeze(
  BASE_POLICIES.map((policy) => ({
    ...policy,
    termsReference: policy.termsUrl,
    retentionRule:
      policy.retentionRule ||
      `Delete after ${policy.retentionDays} days or earlier when source marks inactive.`,
    quotaPolicy:
      policy.quotaPolicy ||
      `${policy.quota.requestsPerDay} requests per day; minimum interval ${policy.quota.intervalMs}ms.`,
  })),
);

export function isSourcePolicyComplete(policy: Partial<SourcePolicy> | null | undefined): boolean {
  return Boolean(
    policy?.termsUrl &&
      policy?.termsReference &&
      policy?.attributionText &&
      policy?.attributionUrl &&
      /^[A-Za-z0-9_-]+Adapter\.js$/.test(policy?.adapterModule || "") &&
      policy?.retentionRule &&
      policy?.quotaPolicy &&
      typeof policy?.retentionDays === "number" &&
      Number.isFinite(policy.retentionDays) &&
      policy.retentionDays > 0 &&
      typeof policy?.staleAfterDays === "number" &&
      Number.isFinite(policy.staleAfterDays) &&
      policy.staleAfterDays > 0 &&
      typeof policy?.quota?.requestsPerDay === "number" &&
      Number.isFinite(policy.quota.requestsPerDay) &&
      policy.quota.requestsPerDay > 0 &&
      policy?.termsVerifiedAt,
  );
}

const SOURCE_ENV_FLAGS: Record<string, string> = Object.freeze({
  jobicy: "ENABLE_JOBICY_INGESTION",
  greenhouse: "ENABLE_GREENHOUSE_INGESTION",
  lever: "ENABLE_LEVER_INGESTION",
  ashby: "ENABLE_ASHBY_INGESTION",
});

export function isSourceEnabledByEnvironment(
  sourceKey: string,
  config: Record<string, unknown> = env as unknown as Record<string, unknown>,
): boolean {
  const flag = SOURCE_ENV_FLAGS[sourceKey];
  return flag ? config[flag] === true : true;
}

export interface SourceActivationInput {
  key?: string;
  writtenRedistributionPermissionReference?: unknown;
  commercialLicenseReference?: unknown;
  attributionBadgeVerified?: unknown;
  storageDisplayTermsReviewed?: unknown;
}

export function isSourceActivationAllowed(
  source?: SourceActivationInput | null,
): boolean {
  if (source?.key === "remotive")
    return Boolean(source?.writtenRedistributionPermissionReference);
  if (source?.key !== "adzuna-india") return true;
  return Boolean(
    source?.commercialLicenseReference &&
      source?.attributionBadgeVerified &&
      source?.storageDisplayTermsReviewed,
  );
}
