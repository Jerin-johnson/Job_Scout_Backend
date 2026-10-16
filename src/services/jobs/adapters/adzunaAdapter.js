import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

export function normalizeAdzunaJob(raw) {
  if (!raw?.id || !raw?.title || !raw?.redirect_url) return null;
  const minimum = Number(raw.salary_min) || null;
  const maximum = Number(raw.salary_max) || null;
  return {
    sourceJobId: String(raw.id), title: String(raw.title), company: String(raw.company?.display_name || "Employer not disclosed"),
    location: String(raw.location?.display_name || "India"), sourceUrl: String(raw.redirect_url), canonicalUrl: String(raw.redirect_url),
    postedAt: raw.created ? new Date(raw.created) : null,
    rawDescription: sourceDescriptionText(raw.description || raw.title),
    salaryRange: { min: minimum || 0, max: maximum || 0, currency: "INR" },
    compensation: { originalText: minimum || maximum ? `₹${minimum || maximum}–₹${maximum || minimum} INR` : "", currency: "INR", payPeriod: "unknown", min: minimum, max: maximum },
    tags: [raw.category?.label].filter(Boolean),
    attributionText: "Adzuna", attributionUrl: "https://www.adzuna.in/",
  };
}

export class AdzunaAdapter extends BaseJobAdapter {
  constructor(options = {}) {
    super({ key: "adzuna-india", displayName: "Adzuna India", intervalMs: 86400000, timeoutMs: 8000, maxRetries: 1, capabilities: { paging: true, demandSearch: true, attributionRequired: true, fields: ["title", "company", "location", "description", "salary", "sourceUrl"] } });
    this.requestsPerRun = Math.min(25, Number(options.limits?.perMinute) || 25);
  }

  async fetchPage({ demandTerm, cursor } = {}) {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) throw Object.assign(new Error("Adzuna credentials are not configured"), { code: "SOURCE_CREDENTIALS_MISSING" });
    if (!demandTerm) return { jobs: [], done: true, cursor: null };
    const page = Math.max(1, Number.parseInt(cursor || "1", 10) || 1);
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/in/search/${page}`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("what", demandTerm.slice(0, 50));
    url.searchParams.set("results_per_page", "50");
    url.searchParams.set("content-type", "application/json");
    const result = await this.requestJson(url.toString());
    const jobs = (result.data?.results || []).map(normalizeAdzunaJob).filter(Boolean);
    const next = jobs.length && page < 5 ? String(page + 1) : null;
    return { jobs, cursor: next, done: !next };
  }
}

export default AdzunaAdapter;
