import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function text(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") return String(firstValue(value.label, value.name, value.value, value.text) || "").trim();
  return "";
}

function isInactive(raw) {
  const status = String(firstValue(raw?.status, raw?.state, raw?.statusCode) || "").toLowerCase();
  return raw?.active === false || raw?.isActive === false || raw?.deleted === true || raw?.inactive === true ||
    ["inactive", "deleted", "closed", "expired", "withdrawn", "unpublished"].includes(status);
}

export function normalizeNavJobEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = firstValue(raw.sourceJobId, raw.uuid, raw.id, raw.annonsId, raw.adId);
  if (id === undefined) return null;
  const sourceJobId = String(id).trim();
  if (!sourceJobId) return null;
  if (isInactive(raw)) return { type: "delete", sourceJobId };

  const title = text(firstValue(raw.title, raw.occupation?.title, raw.occupation?.name, raw.jobTitle));
  const company = text(firstValue(raw.employer?.name, raw.employerName, raw.company?.name, raw.company));
  const sourceUrl = text(firstValue(raw.applicationUrl, raw.application?.url, raw.url, raw.webpageUrl, raw.links?.application));
  // NAV's terms expect a deep link to the original application function.
  if (!title || !company || !sourceUrl) return null;
  const location = text(firstValue(raw.location?.label, raw.location?.name, raw.workplace?.label, raw.location, "Norway"));
  const postedAtValue = firstValue(raw.publishedAt, raw.publicationDate, raw.createdAt, raw.created);
  const postedAt = postedAtValue ? new Date(postedAtValue) : null;
  const categories = [raw.category, raw.occupation?.category, raw.occupation?.group].map(text).filter(Boolean);
  const description = text(firstValue(raw.description?.text, raw.description, raw.jobText));
  return {
    type: "upsert",
    sourceJobId,
    job: {
      sourceJobId,
      title,
      company,
      location: location.slice(0, 200),
      structuredLocation: { countryCode: "NO", remoteScope: "unknown" },
      remoteType: "onsite",
      sourceUrl,
      canonicalUrl: sourceUrl,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      sourceExpiresAt: null,
      rawDescription: sourceDescriptionText(description || `${title} at ${company}`),
      sourceCategory: categories.join(" / ").slice(0, 160),
      tags: categories.slice(0, 20),
      requirements: [],
      salaryRange: { min: 0, max: 0, currency: "" },
      compensation: { originalText: text(raw.salary?.label || raw.salary), currency: "", payPeriod: "unknown" },
    },
  };
}

export class NavJobFeedAdapter extends BaseJobAdapter {
  constructor(options = {}) {
    super({ key: "nav-no", displayName: "Norway NAV", intervalMs: 60 * 60 * 1000, timeoutMs: 15000, maxRetries: 1, capabilities: { paging: true, changeEvents: true, deletions: true, bearerToken: true, fields: ["title", "company", "location", "category", "description", "postedAt", "applicationUrl"] }, ...options });
    this.feedUrl = options.feedUrl || process.env.NAV_JOB_FEED_URL || "";
    this.token = options.token || process.env.NAV_JOB_FEED_TOKEN || "";
  }

  async fetchPage({ cursor } = {}) {
    if (!this.token) {
      const error = new Error("NAV feed credentials are not configured.");
      error.code = "NAV_FEED_TOKEN_MISSING";
      throw error;
    }
    if (!this.feedUrl) {
      const error = new Error("NAV feed URL is not configured.");
      error.code = "NAV_FEED_URL_MISSING";
      throw error;
    }
    const url = new URL(this.feedUrl);
    if (cursor) url.searchParams.set("cursor", String(cursor));
    const result = await this.requestJson(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const data = result.data;
    const entries = Array.isArray(data) ? data : data?.events || data?.ads || data?.items || data?.data || [];
    const events = entries.map(normalizeNavJobEvent).filter(Boolean);
    const inactiveIds = [...new Set(events.filter((event) => event.type === "delete").map((event) => event.sourceJobId))];
    return {
      jobs: events.filter((event) => event.type === "upsert").map((event) => event.job),
      inactiveIds,
      cursor: data?.nextCursor || data?.cursor || null,
      done: data?.done ?? !data?.nextCursor,
      etag: result.etag,
      lastModified: result.lastModified,
    };
  }
}

export default NavJobFeedAdapter;
