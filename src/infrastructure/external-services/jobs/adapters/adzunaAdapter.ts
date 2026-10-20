import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

export interface NormalizedAdzunaJob {
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  canonicalUrl: string;
  postedAt: Date | null;
  rawDescription: string;
  salaryRange: { min: number; max: number; currency: string };
  compensation: {
    originalText: string;
    currency: string;
    payPeriod: string;
    min: number | null;
    max: number | null;
  };
  tags: string[];
  attributionText: string;
  attributionUrl: string;
}

export function normalizeAdzunaJob(
  raw: Record<string, unknown> | null | undefined,
): NormalizedAdzunaJob | null {
  if (!raw?.id || !raw?.title || !raw?.redirect_url) return null;
  const minimum = Number(raw.salary_min) || null;
  const maximum = Number(raw.salary_max) || null;
  const companyObj = raw.company as { display_name?: string } | undefined;
  const locationObj = raw.location as { display_name?: string } | undefined;
  const categoryObj = raw.category as { label?: string } | undefined;

  return {
    sourceJobId: String(raw.id),
    title: String(raw.title),
    company: String(companyObj?.display_name || "Employer not disclosed"),
    location: String(locationObj?.display_name || "India"),
    sourceUrl: String(raw.redirect_url),
    canonicalUrl: String(raw.redirect_url),
    postedAt: raw.created ? new Date(String(raw.created)) : null,
    rawDescription: sourceDescriptionText(raw.description || raw.title),
    salaryRange: { min: minimum || 0, max: maximum || 0, currency: "INR" },
    compensation: {
      originalText: minimum || maximum ? `₹${minimum || maximum}–₹${maximum || minimum} INR` : "",
      currency: "INR",
      payPeriod: "unknown",
      min: minimum,
      max: maximum,
    },
    tags: categoryObj?.label ? [categoryObj.label] : [],
    attributionText: "Adzuna",
    attributionUrl: "https://www.adzuna.in/",
  };
}

export interface AdzunaAdapterOptions {
  limits?: { perMinute?: number | string };
  [key: string]: unknown;
}

export class AdzunaAdapter extends BaseJobAdapter {
  requestsPerRun: number;

  constructor(options: AdzunaAdapterOptions = {}) {
    super({
      key: "adzuna-india",
      displayName: "Adzuna India",
      intervalMs: 86400000,
      timeoutMs: 8000,
      maxRetries: 1,
      capabilities: {
        paging: true,
        demandSearch: true,
        attributionRequired: true,
        fields: ["title", "company", "location", "description", "salary", "sourceUrl"],
      },
    });
    this.requestsPerRun = Math.min(25, Number(options.limits?.perMinute) || 25);
  }

  async fetchPage({
    demandTerm,
    cursor,
  }: { demandTerm?: string; cursor?: string | null } = {}): Promise<{
    jobs: NormalizedAdzunaJob[];
    cursor: string | null;
    done: boolean;
  }> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) {
      const err = new Error("Adzuna credentials are not configured") as Error & { code?: string };
      err.code = "SOURCE_CREDENTIALS_MISSING";
      throw err;
    }
    if (!demandTerm) return { jobs: [], done: true, cursor: null };
    const page = Math.max(1, Number.parseInt(cursor || "1", 10) || 1);
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/in/search/${page}`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("what", demandTerm.slice(0, 50));
    url.searchParams.set("results_per_page", "50");
    url.searchParams.set("content-type", "application/json");

    const result = await this.requestJson<{ results?: Array<Record<string, unknown>> }>(
      url.toString(),
    );
    const rawJobs = result.data?.results || [];
    const jobs = rawJobs
      .map(normalizeAdzunaJob)
      .filter((j): j is NormalizedAdzunaJob => j !== null);
    const next = jobs.length && page < 5 ? String(page + 1) : null;
    return { jobs, cursor: next, done: !next };
  }
}

export default AdzunaAdapter;
