import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

export function normalizeJobicyJob(raw) {
  const title = String(raw?.jobTitle || raw?.title || "").trim();
  const company = String(raw?.companyName || raw?.company || "").trim();
  const sourceJobId = raw?.id === null || raw?.id === undefined ? "" : String(raw.id);
  const sourceUrl = String(raw?.url || "");
  if (!title || !company || !sourceJobId || !sourceUrl) return null;
  const location = String(raw.jobGeo || raw.geo || raw.location || "Remote").slice(0, 200);
  const tags = [ ...(Array.isArray(raw.jobIndustry) ? raw.jobIndustry : []), ...(Array.isArray(raw.jobType) ? raw.jobType : []) ].map(String).slice(0, 40);
  const occupationCodes = (Array.isArray(raw.jobIndustry) ? raw.jobIndustry : [])
    .map((value) => `jobicy:${String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`)
    .filter((value) => value !== "jobicy:")
    .slice(0, 20);
  const salaryMin = Number(raw.salaryMin ?? raw.annualSalaryMin) || 0;
  const salaryMax = Number(raw.salaryMax ?? raw.annualSalaryMax) || 0;
  const currency = String(raw.salaryCurrency || "").toUpperCase();
  const salary = salaryMin || salaryMax;
  const rawPeriod = String(raw.salaryPeriod || raw.payPeriod || "").toLowerCase();
  const payPeriod = ({ hourly: "hour", hour: "hour", daily: "day", day: "day", monthly: "month", month: "month", yearly: "year", annual: "year", annually: "year", year: "year", contract: "contract" })[rawPeriod] || "unknown";
  const salaryText = String(raw.salary || (salary ? `${salaryMin || salaryMax}-${salaryMax || salaryMin} ${currency} ${rawPeriod}` : "")).slice(0, 200);
  const postedAt = raw.pubDate ? new Date(raw.pubDate) : raw.publicationDate ? new Date(raw.publicationDate) : null;
  return {
    title, company, location,
    structuredLocation: { remoteScope: /anywhere|worldwide/i.test(location) ? "worldwide" : "unknown" },
    remoteType: "remote",
    salaryRange: { min: salaryMin, max: salaryMax, currency },
    compensation: { originalText: salaryText, currency: salary ? currency : "", payPeriod: salary ? payPeriod : "unknown", min: salary ? salaryMin : null, max: salary ? salaryMax : null },
    requirements: tags, tags, occupationCodes,
    rawDescription: sourceDescriptionText(raw.jobDescription || raw.jobExcerpt || `${title} at ${company}`),
    sourceBoard: "jobicy", sourceJobId, sourceUrl, canonicalUrl: sourceUrl,
    postedAt,
    sourceExpiresAt: postedAt && !Number.isNaN(postedAt.getTime()) ? new Date(postedAt.getTime() + 7 * 86400000) : null,
  };
}

export class JobicyAdapter extends BaseJobAdapter {
  constructor(options = {}) {
    super({ key: "jobicy", displayName: "Jobicy", intervalMs: 3600000, timeoutMs: 15000, capabilities: { paging: true, conditionalRequests: true, statusCheck: true, demandSearch: true, fields: ["title", "company", "location", "industry", "type", "description", "salary", "postedAt", "sourceUrl"] }, ...options });
  }

  async fetchPage({ cursor, etag, lastModified, demandTerm } = {}) {
    const url = new URL("https://jobicy.com/api/v2/remote-jobs");
    url.searchParams.set("count", "200");
    if (demandTerm) url.searchParams.set("tag", demandTerm.slice(0, 50));
    if (cursor) url.searchParams.set("cursor", cursor);
    const headers = {};
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;
    const result = await this.requestJson(url, { headers, acceptNotModified: true });
    if (result.notModified) return { ...result, done: true };
    const jobs = (Array.isArray(result.data?.jobs) ? result.data.jobs : []).map(normalizeJobicyJob).filter(Boolean);
    const nextCursor = result.data?.nextCursor || null;
    return { jobs, cursor: nextCursor, done: !nextCursor, etag: result.etag, lastModified: result.lastModified };
  }

  async checkStatuses(ids) {
    if (!Array.isArray(ids) || !ids.length) return [];
    const url = new URL("https://jobicy.com/api/v2/remote-jobs/status");
    url.searchParams.set("ids", ids.slice(0, 100).join(","));
    const result = await this.requestJson(url);
    return Array.isArray(result.data?.jobs) ? result.data.jobs : [];
  }
}

export default JobicyAdapter;
