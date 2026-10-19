import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { SavedSearch } from "../../models/SavedSearch.js";
import { User } from "../../models/User.js";
import { isMongoReady } from "../../config/database.js";
import { PLANS, PLAN_CONFIG } from "../../shared/constants/plans.js";
import { jobIngestionService } from "./jobIngestionService.js";
import { emailDigestService } from "../emailDigestService.js";

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

export const savedSearchService = {
  async listByUser(
    userId?: string | string[],
    { plan = PLANS.FREE }: { plan?: string } = {},
  ): Promise<{ savedSearches: Array<SavedSearchDto | null>; limits: SavedSearchPlanLimits }> {
    const uid = Array.isArray(userId) ? String(userId[0] || "") : String(userId || "");
    const limits = getSavedSearchPlanLimits(plan);
    if (!uid) return { savedSearches: [], limits };
    if (isMongoReady()) {
      const rows = (await SavedSearch.find({ userId: uid })
        .sort({ createdAt: -1 })
        .limit(limits.savedSearchesMax)
        .lean()) as unknown as SavedSearchRecord[];
      return {
        savedSearches: rows.map((row) => formatSavedSearchDto(row, true)),
        limits,
      };
    }
    const rows = [...inMemorySavedSearches.values()]
      .filter((row) => String(row.userId) === uid)
      .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())
      .slice(0, limits.savedSearchesMax);
    return {
      savedSearches: rows.map((row) => formatSavedSearchDto(row, true)),
      limits,
    };
  },

  async create(user?: UserLike | null, payload: CreateSavedSearchPayload = {}): Promise<SavedSearchDto | null> {
    const uid = String(user?._id || user?.id || "");
    if (!uid) {
      const error = new Error("Authentication required") as Error & { statusCode?: number };
      error.statusCode = 401;
      throw error;
    }
    const plan = user?.plan || PLANS.FREE;
    const limits = getSavedSearchPlanLimits(plan);
    const existingCount = isMongoReady()
      ? await SavedSearch.countDocuments({ userId: uid })
      : [...inMemorySavedSearches.values()].filter((row) => String(row.userId) === uid).length;

    if (existingCount >= limits.savedSearchesMax) {
      const error = new Error(
        `Your ${limits.tier} plan supports up to ${limits.savedSearchesMax} saved searches.`,
      ) as Error & { statusCode?: number; code?: string };
      error.statusCode = 403;
      error.code = "SAVED_SEARCH_LIMIT_REACHED";
      throw error;
    }

    const filters = sanitizeSavedSearchFilters(payload.filters);
    const fallbackName =
      [filters.q, filters.occupation, filters.location || filters.countryCode, filters.remoteType]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 80) || "All jobs";
    const name =
      String(payload.name || fallbackName)
        .trim()
        .slice(0, 80) || fallbackName;
    const alertFrequency = ["none", "instant", "daily"].includes(String(payload.alertFrequency))
      ? String(payload.alertFrequency)
      : "daily";
    const alertChannels = Array.isArray(payload.alertChannels)
      ? payload.alertChannels.filter((channel) => ["in_app", "email"].includes(channel))
      : ["in_app", "email"];
    const quietHours = {
      enabled: Boolean(payload.quietHours?.enabled),
      startHourUtc: Math.min(23, Math.max(0, Number(payload.quietHours?.startHourUtc ?? 22))),
      endHourUtc: Math.min(23, Math.max(0, Number(payload.quietHours?.endHourUtc ?? 7))),
    };
    const unsubscribeToken = randomBytes(24).toString("hex");

    if (isMongoReady()) {
      const created = await SavedSearch.create({
        userId: uid,
        name,
        filters,
        alertFrequency,
        alertChannels: alertChannels.length ? alertChannels : ["in_app"],
        quietHours,
        enabled: payload.enabled !== false,
        unsubscribeToken,
      });
      return formatSavedSearchDto(created.toObject() as unknown as SavedSearchRecord, true);
    }

    const now = new Date();
    const id = new mongoose.Types.ObjectId().toString();
    const record: SavedSearchRecord = {
      _id: id,
      userId: uid,
      name,
      filters,
      alertFrequency,
      alertChannels: alertChannels.length ? alertChannels : ["in_app"],
      quietHours,
      enabled: payload.enabled !== false,
      unsubscribeToken,
      sentJobIds: [],
      lastAlertedAt: null,
      alertsSentToday: 0,
      alertWindowDay: "",
      createdAt: now,
      updatedAt: now,
    };
    inMemorySavedSearches.set(id, record);
    return formatSavedSearchDto(record, true);
  },

  async update(
    userId?: string | string[],
    searchId?: string | string[],
    patch: UpdateSavedSearchPayload = {},
  ): Promise<SavedSearchDto | null> {
    const uid = Array.isArray(userId) ? String(userId[0] || "") : String(userId || "");
    const sid = Array.isArray(searchId) ? String(searchId[0] || "") : String(searchId || "");
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const cleanName = String(patch.name || "")
        .trim()
        .slice(0, 80);
      if (cleanName) updates.name = cleanName;
    }
    if (patch.filters !== undefined) {
      updates.filters = sanitizeSavedSearchFilters(patch.filters);
    }
    if (
      patch.alertFrequency !== undefined &&
      ["none", "instant", "daily"].includes(patch.alertFrequency)
    ) {
      updates.alertFrequency = patch.alertFrequency;
    }
    if (Array.isArray(patch.alertChannels)) {
      const channels = patch.alertChannels.filter((c) => ["in_app", "email"].includes(c));
      if (channels.length) updates.alertChannels = channels;
    }
    if (patch.quietHours !== undefined) {
      updates.quietHours = {
        enabled: Boolean(patch.quietHours?.enabled),
        startHourUtc: Math.min(23, Math.max(0, Number(patch.quietHours?.startHourUtc ?? 22))),
        endHourUtc: Math.min(23, Math.max(0, Number(patch.quietHours?.endHourUtc ?? 7))),
      };
    }
    if (typeof patch.enabled === "boolean") {
      updates.enabled = patch.enabled;
    }

    if (isMongoReady()) {
      if (!mongoose.Types.ObjectId.isValid(sid)) return null;
      const updated = (await SavedSearch.findOneAndUpdate(
        { _id: sid, userId: uid },
        { $set: updates },
        { new: true },
      ).lean()) as unknown as SavedSearchRecord;
      return formatSavedSearchDto(updated, true);
    }

    const existing = inMemorySavedSearches.get(sid);
    if (!existing || String(existing.userId) !== uid) return null;
    const merged = { ...existing, ...updates, updatedAt: new Date() };
    inMemorySavedSearches.set(sid, merged);
    return formatSavedSearchDto(merged, true);
  },

  async remove(userId?: string | string[], searchId?: string | string[]): Promise<boolean> {
    const uid = Array.isArray(userId) ? String(userId[0] || "") : String(userId || "");
    const sid = Array.isArray(searchId) ? String(searchId[0] || "") : String(searchId || "");
    if (isMongoReady()) {
      if (!mongoose.Types.ObjectId.isValid(sid)) return false;
      const res = await SavedSearch.deleteOne({ _id: sid, userId: uid });
      return Boolean(res.deletedCount);
    }
    const existing = inMemorySavedSearches.get(sid);
    if (!existing || String(existing.userId) !== uid) return false;
    inMemorySavedSearches.delete(sid);
    return true;
  },

  async unsubscribe(
    searchId: string,
    { token = "", userId = "" }: { token?: string; userId?: string } = {},
  ): Promise<SavedSearchDto | null> {
    const cleanToken = String(token || "").trim();
    const uid = String(userId || "").trim();
    if (!cleanToken && !uid) return null;

    if (isMongoReady()) {
      if (!mongoose.Types.ObjectId.isValid(searchId)) return null;
      const filter = cleanToken
        ? { _id: searchId, unsubscribeToken: cleanToken }
        : { _id: searchId, userId: uid };
      const updated = (await SavedSearch.findOneAndUpdate(
        filter,
        { $set: { enabled: false, alertFrequency: "none" } },
        { new: true },
      ).lean()) as unknown as SavedSearchRecord;
      return formatSavedSearchDto(updated, false);
    }

    const existing = inMemorySavedSearches.get(String(searchId));
    if (!existing) return null;
    if (cleanToken && existing.unsubscribeToken !== cleanToken) return null;
    if (!cleanToken && String(existing.userId) !== uid) return null;
    const updated = {
      ...existing,
      enabled: false,
      alertFrequency: "none",
      updatedAt: new Date(),
    };
    inMemorySavedSearches.set(String(searchId), updated);
    return formatSavedSearchDto(updated, false);
  },

  async preview(
    filters: Record<string, unknown> = {},
    { limit = 5, eligibilityCountryCodes = [] }: { limit?: number; eligibilityCountryCodes?: string[] } = {},
  ): Promise<{
    filters: SavedSearchFilters;
    total: number;
    totalIsApproximate: boolean;
    sampleJobs: Array<{
      jobId: string;
      title: unknown;
      company: unknown;
      location: unknown;
      remoteType: unknown;
      postedAt: unknown;
      sourceBoard: unknown;
    }>;
  }> {
    const cleanFilters = sanitizeSavedSearchFilters(filters);
    const safeLimit = Math.min(10, Math.max(1, Number(limit) || 5));
    const result = await jobIngestionService.searchJobs({
      ...cleanFilters,
      eligibilityCountryCodes,
      limit: safeLimit,
    });
    return {
      filters: cleanFilters,
      total: result.total,
      totalIsApproximate: Boolean(result.totalIsApproximate),
      sampleJobs: (result.jobs || []).slice(0, safeLimit).map((job) => ({
        jobId: String(job.jobId || job._id),
        title: job.title,
        company: job.company,
        location: job.location,
        remoteType: job.remoteType,
        postedAt: job.postedAt || null,
        sourceBoard: job.sourceBoard,
      })),
    };
  },

  async dispatchSavedSearchAlerts({
    frequency = "daily",
    now = new Date(),
    maxSearches = 100,
  }: {
    frequency?: string;
    now?: Date | string | number;
    maxSearches?: number;
  } = {}): Promise<{ checked: number; alertsDispatched: number; skipped: number }> {
    const rows: SavedSearchRecord[] = isMongoReady()
      ? ((await SavedSearch.find({
          enabled: true,
          alertFrequency: frequency,
        })
          .sort({ lastAlertedAt: 1 })
          .limit(maxSearches)
          .lean()) as unknown as SavedSearchRecord[])
      : [...inMemorySavedSearches.values()]
          .filter((item) => item.enabled && item.alertFrequency === frequency)
          .slice(0, maxSearches);

    let alertsDispatched = 0;
    let skipped = 0;
    for (const savedSearch of rows) {
      const user: UserLike | null =
        isMongoReady() && mongoose.Types.ObjectId.isValid(String(savedSearch.userId))
          ? ((await User.findById(savedSearch.userId).select("email name plan isDeleted").lean()) as unknown as UserLike)
          : { email: "candidate@example.com", name: "Candidate", plan: PLANS.FREE };
      if (!user || user.isDeleted) {
        skipped += 1;
        continue;
      }
      const gate = canSendSavedSearchAlert(savedSearch, { plan: user.plan, now });
      if (!gate.allowed) {
        skipped += 1;
        continue;
      }
      const searchResult = await jobIngestionService.searchJobs({
        ...sanitizeSavedSearchFilters(savedSearch.filters as Record<string, unknown>),
        limit: 15,
      });
      const unsentJobs = selectUnsentAlertJobs(
        searchResult.jobs || [],
        savedSearch.sentJobIds || [],
        {
          maxJobs: 5,
        },
      );
      if (!unsentJobs.length) {
        skipped += 1;
        continue;
      }

      if ((savedSearch.alertChannels || []).includes("email") && user.email) {
        await emailDigestService.sendDailyDigest({
          toEmail: user.email,
          candidateName: user.name || "Candidate",
          matches: unsentJobs.map((job) => ({
            score: 90,
            rationale: `Matches saved search "${savedSearch.name}"`,
            missingSkills: [],
            jobDetails: {
              title: String(job.title || ""),
              company: String(job.company || ""),
            },
          })),
        });
      }

      const nextSentIds = appendBoundedSentJobIds(
        savedSearch.sentJobIds,
        unsentJobs.map((job) => String(job.jobId || job._id)),
      );
      if (isMongoReady()) {
        await SavedSearch.updateOne(
          { _id: savedSearch._id },
          {
            $set: {
              sentJobIds: nextSentIds,
              lastAlertedAt: new Date(now),
              alertWindowDay: gate.dayKey,
              alertsSentToday: (gate.sentToday || 0) + 1,
            },
          },
        );
      } else {
        inMemorySavedSearches.set(String(savedSearch._id), {
          ...savedSearch,
          sentJobIds: nextSentIds,
          lastAlertedAt: new Date(now),
          alertWindowDay: gate.dayKey,
          alertsSentToday: (gate.sentToday || 0) + 1,
        });
      }
      alertsDispatched += 1;
    }

    return {
      checked: rows.length,
      alertsDispatched,
      skipped,
    };
  },

  async exportForUser(userId?: string | string[]): Promise<Array<SavedSearchDto | null>> {
    const uid = Array.isArray(userId) ? String(userId[0] || "") : String(userId || "");
    if (!uid) return [];
    if (isMongoReady()) {
      const rows = (await SavedSearch.find({ userId: uid })
        .select("-unsubscribeToken")
        .sort({ createdAt: -1 })
        .lean()) as unknown as SavedSearchRecord[];
      return rows.map((row) => formatSavedSearchDto(row, false));
    }
    return [...inMemorySavedSearches.values()]
      .filter((row) => String(row.userId) === uid)
      .map((row) => formatSavedSearchDto(row, false));
  },

  async deleteAllForUser(userId?: string | string[]): Promise<number> {
    const uid = Array.isArray(userId) ? String(userId[0] || "") : String(userId || "");
    if (!uid) return 0;
    if (isMongoReady()) {
      const res = await SavedSearch.deleteMany({ userId: uid });
      return res.deletedCount || 0;
    }
    let deleted = 0;
    for (const [id, row] of inMemorySavedSearches.entries()) {
      if (String(row.userId) === uid) {
        inMemorySavedSearches.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  },
};
