import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") {
    const obj = value as { label?: unknown; name?: unknown; value?: unknown; text?: unknown };
    return String(firstValue(obj.label, obj.name, obj.value, obj.text) || "").trim();
  }
  return "";
}

function isInactive(raw: Record<string, unknown> | null | undefined): boolean {
  const status = String(firstValue(raw?.status, raw?.state, raw?.statusCode) || "").toLowerCase();
  return (
    raw?.active === false ||
    raw?.isActive === false ||
    raw?.deleted === true ||
    raw?.inactive === true ||
    ["inactive", "deleted", "closed", "expired", "withdrawn", "unpublished"].includes(status)
  );
}

export interface NormalizedNavJob {
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  structuredLocation: { countryCode: string; remoteScope: string };
  remoteType: string;
  sourceUrl: string;
  canonicalUrl: string;
  postedAt: Date | null;
  sourceExpiresAt: null;
  rawDescription: string;
  sourceCategory: string;
  tags: string[];
  requirements: string[];
  salaryRange: { min: number; max: number; currency: string };
  compensation: { originalText: string; currency: string; payPeriod: string };
}

export interface NavJobEvent {
  type: "upsert" | "delete";
  sourceJobId: string;
  job?: NormalizedNavJob;
}

export function normalizeNavJobEvent(raw: Record<string, unknown> | null | undefined): NavJobEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const id = firstValue(raw.sourceJobId, raw.uuid, raw.id, raw.annonsId, raw.adId);
  if (id === undefined) return null;
  const sourceJobId = String(id).trim();
  if (!sourceJobId) return null;
  if (isInactive(raw)) return { type: "delete", sourceJobId };

  const rawOcc = raw.occupation as Record<string, unknown> | undefined;
  const rawEmp = raw.employer as Record<string, unknown> | undefined;
  const rawComp = raw.company as Record<string, unknown> | undefined;
  const rawApp = raw.application as Record<string, unknown> | undefined;
  const rawLinks = raw.links as Record<string, unknown> | undefined;
  const rawLoc = raw.location as Record<string, unknown> | undefined;
  const rawWork = raw.workplace as Record<string, unknown> | undefined;
  const rawDesc = raw.description as Record<string, unknown> | undefined;
  const rawSal = raw.salary as Record<string, unknown> | undefined;

  const title = text(firstValue(raw.title, rawOcc?.title, rawOcc?.name, raw.jobTitle));
  const company = text(firstValue(rawEmp?.name, raw.employerName, rawComp?.name, raw.company));
  const sourceUrl = text(firstValue(raw.applicationUrl, rawApp?.url, raw.url, raw.webpageUrl, rawLinks?.application));
  // NAV's terms expect a deep link to the original application function.
  if (!title || !company || !sourceUrl) return null;
  const location = text(firstValue(rawLoc?.label, rawLoc?.name, rawWork?.label, raw.location, "Norway"));
  const postedAtValue = firstValue(raw.publishedAt, raw.publicationDate, raw.createdAt, raw.created);
  const postedAt = postedAtValue ? new Date(String(postedAtValue)) : null;
  const categories = [raw.category, rawOcc?.category, rawOcc?.group].map(text).filter(Boolean);
  const description = text(firstValue(rawDesc?.text, raw.description, raw.jobText));

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
      compensation: { originalText: text(rawSal?.label || raw.salary), currency: "", payPeriod: "unknown" },
    },
  };
}

export interface NavJobFeedAdapterOptions {
  feedUrl?: string;
  token?: string;
  [key: string]: unknown;
}

export class NavJobFeedAdapter extends BaseJobAdapter {
  feedUrl: string;
  token: string;

  constructor(options: NavJobFeedAdapterOptions = {}) {
    super({
      key: "nav-no",
      displayName: "Norway NAV",
      intervalMs: 60 * 60 * 1000,
      timeoutMs: 15000,
      maxRetries: 1,
      capabilities: {
        paging: true,
        changeEvents: true,
        deletions: true,
        bearerToken: true,
        fields: ["title", "company", "location", "category", "description", "postedAt", "applicationUrl"],
      },
      ...options,
    });
    this.feedUrl = options.feedUrl || process.env.NAV_JOB_FEED_URL || "";
    this.token = options.token || process.env.NAV_JOB_FEED_TOKEN || "";
  }

  async fetchPage({ cursor }: { cursor?: string | null } = {}): Promise<{
    jobs: NormalizedNavJob[];
    inactiveIds: string[];
    cursor: string | null;
    done: boolean;
    etag?: string | null;
    lastModified?: string | null;
  }> {
    if (!this.token) {
      const error = new Error("NAV feed credentials are not configured.") as Error & { code?: string };
      error.code = "NAV_FEED_TOKEN_MISSING";
      throw error;
    }
    if (!this.feedUrl) {
      const error = new Error("NAV feed URL is not configured.") as Error & { code?: string };
      error.code = "NAV_FEED_URL_MISSING";
      throw error;
    }
    const url = new URL(this.feedUrl);
    if (cursor) url.searchParams.set("cursor", String(cursor));
    const result = await this.requestJson<
      | Array<Record<string, unknown>>
      | {
          events?: Array<Record<string, unknown>>;
          ads?: Array<Record<string, unknown>>;
          items?: Array<Record<string, unknown>>;
          data?: Array<Record<string, unknown>>;
          nextCursor?: string;
          cursor?: string;
          done?: boolean;
        }
    >(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    const data = result.data;
    const entries = Array.isArray(data)
      ? data
      : data?.events || data?.ads || data?.items || data?.data || [];
    const events = entries.map((e) => normalizeNavJobEvent(e)).filter((e): e is NavJobEvent => e !== null);
    const inactiveIds = [
      ...new Set(events.filter((event) => event.type === "delete").map((event) => event.sourceJobId)),
    ];
    const dataObj = typeof data === "object" && !Array.isArray(data) ? data : null;

    return {
      jobs: events.filter((event) => event.type === "upsert" && event.job).map((event) => event.job as NormalizedNavJob),
      inactiveIds,
      cursor: dataObj?.nextCursor || dataObj?.cursor || null,
      done: dataObj?.done ?? !dataObj?.nextCursor,
      etag: result.etag,
      lastModified: result.lastModified,
    };
  }
}

export default NavJobFeedAdapter;
