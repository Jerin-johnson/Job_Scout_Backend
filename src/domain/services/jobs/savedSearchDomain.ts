import { PLANS, PLAN_CONFIG } from "../../../shared/constants/plans.js";

export interface SavedSearchFilters {
  q: string;
  location: string;
  countryCode: string;
  occupation: string;
  remoteType: string;
  source: string;
  postedWithinDays: number;
  minimumSalaryInr: number | null;
  eligibility: string;
  showAnyway: boolean;
}

export interface QuietHoursConfig {
  enabled: boolean;
  startHourUtc: number;
  endHourUtc: number;
}

export interface SavedSearchDto {
  id: string;
  userId: string;
  name: string;
  filters: SavedSearchFilters;
  alertFrequency: string;
  alertChannels: string[];
  quietHours: QuietHoursConfig;
  enabled: boolean;
  lastAlertedAt: Date | string | null;
  alertsSentToday: number;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  unsubscribeToken?: string;
}

export interface SavedSearchRecord {
  _id: unknown;
  userId: unknown;
  name: string;
  filters?: Partial<SavedSearchFilters>;
  alertFrequency?: string;
  alertChannels?: string[];
  quietHours?: Partial<QuietHoursConfig>;
  enabled?: boolean;
  unsubscribeToken?: string;
  sentJobIds?: string[];
  lastAlertedAt?: Date | string | null;
  alertsSentToday?: number;
  alertWindowDay?: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  [key: string]: unknown;
}

export interface SavedSearchPlanLimits {
  tier: string;
  savedSearchesMax: number;
  dailyAlertsMax: number;
}

export interface CanSendAlertResult {
  allowed: boolean;
  reason: string;
  sentToday?: number;
  dayKey?: string;
  dailyAlertsMax?: number;
}

const inMemorySavedSearches = new Map<string, SavedSearchRecord>();
const MAX_TRACKED_SENT_JOB_IDS = 200;

export function utcDayKey(now: Date | string | number = new Date()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function getSavedSearchPlanLimits(plan: string = PLANS.FREE): SavedSearchPlanLimits {
  const tier = String(plan || PLANS.FREE).toLowerCase();
  const config = PLAN_CONFIG[tier as keyof typeof PLAN_CONFIG] || PLAN_CONFIG[PLANS.FREE];
  return {
    tier,
    savedSearchesMax: Number(config?.quotas?.savedSearchesMax) || 3,
    dailyAlertsMax: Number(config?.quotas?.dailyAlertsMax) || 2,
  };
}

export function isWithinQuietHours(
  quietHours: Partial<QuietHoursConfig> | null | undefined = {},
  now: Date | string | number = new Date(),
): boolean {
  if (!quietHours?.enabled) return false;
  const start = Number(quietHours.startHourUtc);
  const end = Number(quietHours.endHourUtc);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 23 ||
    end < 0 ||
    end > 23
  ) {
    return false;
  }
  if (start === end) return false;
  const hour = new Date(now).getUTCHours();
  if (start < end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}

export interface CandidateJobLike {
  status?: string;
  jobId?: string;
  _id?: unknown;
  identityKey?: string;
  title?: string;
  company?: string;
  location?: string;
  remoteType?: string;
  postedAt?: Date | string | null;
  sourceBoard?: string;
  [key: string]: unknown;
}

export function selectUnsentAlertJobs<T extends CandidateJobLike>(
  candidateJobs: T[] = [],
  sentJobIds: string[] = [],
  { maxJobs = 10 }: { maxJobs?: number } = {},
): T[] {
  const alreadySent = new Set((Array.isArray(sentJobIds) ? sentJobIds : []).map(String));
  const unsent: T[] = [];
  const cap = Math.max(1, Number(maxJobs) || 10);
  for (const job of Array.isArray(candidateJobs) ? candidateJobs : []) {
    if (!job || job.status === "closed") continue;
    const id = String(job.jobId || job._id || job.identityKey || "");
    if (!id || alreadySent.has(id)) continue;
    alreadySent.add(id);
    unsent.push(job);
    if (unsent.length >= cap) break;
  }
  return unsent;
}

export function appendBoundedSentJobIds(
  existingIds: unknown[] = [],
  newJobIds: unknown[] = [],
  maxTracked = MAX_TRACKED_SENT_JOB_IDS,
): string[] {
  const combined = [
    ...(Array.isArray(existingIds) ? existingIds : []).map(String),
    ...(Array.isArray(newJobIds) ? newJobIds : []).map(String),
  ].filter(Boolean);
  const unique = [...new Set(combined)];
  const cap = Math.max(1, Number(maxTracked) || MAX_TRACKED_SENT_JOB_IDS);
  return unique.length > cap ? unique.slice(unique.length - cap) : unique;
}

export function canSendSavedSearchAlert(
  savedSearch: Partial<SavedSearchRecord> | null | undefined = {},
  {
    plan = PLANS.FREE,
    now = new Date(),
    minInstantIntervalMs = 15 * 60_000,
  }: { plan?: string; now?: Date | string | number; minInstantIntervalMs?: number } = {},
): CanSendAlertResult {
  if (!savedSearch || !savedSearch.enabled) {
    return { allowed: false, reason: "disabled" };
  }
  if (!savedSearch.alertFrequency || savedSearch.alertFrequency === "none") {
    return { allowed: false, reason: "frequency_none" };
  }
  if (isWithinQuietHours(savedSearch.quietHours, now)) {
    return { allowed: false, reason: "quiet_hours" };
  }
  const dayKey = utcDayKey(now);
  const { dailyAlertsMax } = getSavedSearchPlanLimits(plan);
  const sentToday =
    savedSearch.alertWindowDay === dayKey ? Number(savedSearch.alertsSentToday || 0) : 0;
  if (sentToday >= dailyAlertsMax) {
    return { allowed: false, reason: "daily_rate_limit" };
  }
  const nowMs = new Date(now).getTime();
  const lastMs = savedSearch.lastAlertedAt ? new Date(savedSearch.lastAlertedAt).getTime() : 0;
  if (savedSearch.alertFrequency === "daily" && lastMs && nowMs - lastMs < 20 * 3600_000) {
    return { allowed: false, reason: "daily_cooldown" };
  }
  if (savedSearch.alertFrequency === "instant" && lastMs && nowMs - lastMs < minInstantIntervalMs) {
    return { allowed: false, reason: "instant_cooldown" };
  }
  return { allowed: true, reason: "ok", sentToday, dayKey, dailyAlertsMax };
}

export function sanitizeSavedSearchFilters(raw: Record<string, unknown> = {}): SavedSearchFilters {
  const remoteType = ["remote", "hybrid", "onsite"].includes(String(raw?.remoteType || ""))
    ? String(raw.remoteType)
    : "";
  const eligibility = ["eligible", "unknown"].includes(String(raw?.eligibility || ""))
    ? String(raw.eligibility)
    : "";
  const minSalary =
    raw?.minimumSalaryInr !== null &&
    raw?.minimumSalaryInr !== undefined &&
    raw?.minimumSalaryInr !== "" &&
    Number.isFinite(Number(raw.minimumSalaryInr))
      ? Math.max(0, Number(raw.minimumSalaryInr))
      : null;
  return {
    q: String(raw?.q || "")
      .trim()
      .slice(0, 120),
    location: String(raw?.location || "")
      .trim()
      .slice(0, 120),
    countryCode: String(raw?.countryCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 2),
    occupation: String(raw?.occupation || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 60),
    remoteType,
    source: String(raw?.source || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 60),
    postedWithinDays: Math.min(365, Math.max(0, Number(raw?.postedWithinDays) || 0)),
    minimumSalaryInr: minSalary,
    eligibility,
    showAnyway: Boolean(raw?.showAnyway),
  };
}

function formatSavedSearchDto(
  doc: SavedSearchRecord | null | undefined,
  includeUnsubscribeToken = false,
): SavedSearchDto | null {
  if (!doc) return null;
  const dto: SavedSearchDto = {
    id: String(doc._id || doc.id),
    userId: String(doc.userId),
    name: doc.name,
    filters: sanitizeSavedSearchFilters(doc.filters as Record<string, unknown>),
    alertFrequency: doc.alertFrequency || "daily",
    alertChannels: Array.isArray(doc.alertChannels) ? doc.alertChannels : ["in_app", "email"],
    quietHours: {
      enabled: Boolean(doc.quietHours?.enabled),
      startHourUtc: Number(doc.quietHours?.startHourUtc ?? 22),
      endHourUtc: Number(doc.quietHours?.endHourUtc ?? 7),
    },
    enabled: Boolean(doc.enabled),
    lastAlertedAt: doc.lastAlertedAt || null,
    alertsSentToday: Number(doc.alertsSentToday || 0),
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
  if (includeUnsubscribeToken && doc.unsubscribeToken) {
    dto.unsubscribeToken = doc.unsubscribeToken;
  }
  return dto;
}

export interface UserLike {
  _id?: unknown;
  id?: string;
  name?: string;
  email?: string;
  plan?: string;
  isDeleted?: boolean;
}

export interface CreateSavedSearchPayload {
  name?: string;
  filters?: Record<string, unknown>;
  alertFrequency?: string;
  alertChannels?: string[];
  quietHours?: Partial<QuietHoursConfig>;
  enabled?: boolean;
}

export interface UpdateSavedSearchPayload {
  name?: string;
  filters?: Record<string, unknown>;
  alertFrequency?: string;
  alertChannels?: string[];
  quietHours?: Partial<QuietHoursConfig>;
  enabled?: boolean;
}
