import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

export function normalizeRemotiveJob(raw) {
  const title = String(raw?.title || "").trim();
  const company = String(raw?.company_name || raw?.company || "").trim();
  const sourceJobId = raw?.id === null || raw?.id === undefined ? "" : String(raw.id);
  const sourceUrl = String(raw?.url || "");
  if (!title || !company || !sourceJobId || !sourceUrl) return null;
  const location = String(raw.candidate_required_location || raw.category || "Remote").slice(0, 200);
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 40) : [];
  const occupationCodes = raw.category ? [`remotive:${String(raw.category).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`] : [];
  return {
    title, company, location,
    structuredLocation: { remoteScope: "unknown", eligibleCountryCodes: [] },
    remoteType: "remote",
    salaryRange: { min: 0, max: 0, currency: "" },
    compensation: { originalText: String(raw.salary || "").slice(0, 200), currency: "", payPeriod: "unknown" },
    requirements: tags, tags, occupationCodes,
    rawDescription: sourceDescriptionText(raw.description || raw.job_description || `${title} at ${company}`),
    sourceBoard: "remotive", sourceJobId, sourceUrl, canonicalUrl: sourceUrl,
    postedAt: raw.publication_date ? new Date(raw.publication_date) : null,
    sourceExpiresAt: raw.expiration_date ? new Date(raw.expiration_date) : null,
  };
}

export class RemotiveAdapter extends BaseJobAdapter {
  constructor(options = {}) {
    super({ key: "remotive", displayName: "Remotive", intervalMs: 21600000, capabilities: { paging: false, conditionalRequests: true, demandSearch: true, fields: ["title", "company", "location", "category", "tags", "description", "salary", "postedAt", "sourceUrl"] }, ...options });
  }

  async fetchPage({ etag, lastModified, demandTerm } = {}) {
    const url = new URL("https://remotive.com/api/remote-jobs");
    if (demandTerm) url.searchParams.set("search", demandTerm.slice(0, 50));
    const headers = {};
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;
    const result = await this.requestJson(url, { headers, acceptNotModified: true });
    if (result.notModified) return { ...result, done: true };
    return {
      jobs: (Array.isArray(result.data?.jobs) ? result.data.jobs : []).map(normalizeRemotiveJob).filter(Boolean),
      etag: result.etag,
      lastModified: result.lastModified,
      done: true,
      cursor: null,
    };
  }
}

export default RemotiveAdapter;
