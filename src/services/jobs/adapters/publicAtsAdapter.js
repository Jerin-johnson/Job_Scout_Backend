import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";
import { TrackedCompany } from "../../../models/TrackedCompany.js";

export function normalizePublicAtsJob(platform, slug, raw) {
  if (platform === "ashby" && raw?.isListed !== true) return null;
  if (platform === "greenhouse") return {
    sourceJobId: String(raw.id), title: raw.title, company: slug,
    location: raw.location?.name || "Unspecified", sourceUrl: raw.absolute_url,
    postedAt: raw.updated_at ? new Date(raw.updated_at) : null,
    rawDescription: sourceDescriptionText(raw.content),
    tags: [...(raw.departments || []).map((item) => item.name), ...(raw.offices || []).map((item) => item.name)].slice(0, 30),
  };
  if (platform === "lever") return {
    sourceJobId: String(raw.id), title: raw.text, company: slug,
    location: raw.categories?.location || "Unspecified", sourceUrl: raw.hostedUrl,
    postedAt: raw.createdAt ? new Date(raw.createdAt) : null,
    rawDescription: sourceDescriptionText(raw.descriptionPlain),
    tags: [raw.categories?.team, raw.categories?.department, raw.categories?.commitment].filter(Boolean).slice(0, 30),
  };
  return {
    sourceJobId: String(raw.id), title: raw.title, company: slug,
    location: raw.location || "Unspecified", sourceUrl: raw.jobUrl,
    postedAt: raw.publishedAt ? new Date(raw.publishedAt) : null,
    rawDescription: sourceDescriptionText(raw.descriptionPlain || raw.description),
    tags: [raw.department, raw.team].filter(Boolean).slice(0, 30),
  };
}

export class PublicAtsAdapter extends BaseJobAdapter {
  constructor(options = {}) {
    super({ key: options.key, displayName: options.key, intervalMs: options.intervalMs || 86400000, timeoutMs: options.timeoutMs || 8000, maxRetries: options.maxRetries ?? 1, capabilities: { paging: true, listedOnly: options.key === "ashby", conditionalRequests: false, fields: ["title", "location", "description", "postedAt", "sourceUrl"] } });
    this.platform = options.key;
    this.requestsPerRun = Math.min(50, Math.max(1, Number(options.requestsPerDay) || 10));
  }

  endpoint(slug) {
    if (this.platform === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
    if (this.platform === "lever") return `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
    return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=false`;
  }

  async fetchBoard(slug) {
    if (this.platform !== "ashby") {
      const response = await this.requestJson(this.endpoint(slug), { acceptNotModified: false });
      const records = this.platform === "greenhouse" ? response.data?.jobs : response.data;
      return (Array.isArray(records) ? records : []).map((record) => normalizePublicAtsJob(this.platform, slug, record)).filter((job) => job.title && job.sourceJobId && job.sourceUrl);
    }
    const response = await this.requestJson(this.endpoint(slug), { acceptNotModified: false });
    return (response.data?.jobs || []).map((record) => normalizePublicAtsJob("ashby", slug, record)).filter((job) => job?.title && job.sourceJobId && job.sourceUrl);
  }

  async fetchPage({ cursor } = {}) {
    const companies = await TrackedCompany.find({ platform: this.platform, status: "approved" }).sort({ _id: 1 }).select("slug").lean();
    const start = Math.min(companies.length, Math.max(0, Number.parseInt(cursor || "0", 10) || 0));
    const budget = this.requestsPerRun;
    const end = Math.min(companies.length, start + budget);
    const jobs = [];
    for (const company of companies.slice(start, end)) jobs.push(...await this.fetchBoard(company.slug));
    return { jobs, cursor: end < companies.length ? String(end) : null, done: end >= companies.length };
  }
}

export default PublicAtsAdapter;
