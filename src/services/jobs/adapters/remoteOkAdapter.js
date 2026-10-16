import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

export function normalizeRemoteOkJob(raw) {
  const title = String(raw?.position || "").trim();
  const company = String(raw?.company || "").trim();
  if (!title || !company || !raw?.id) return null;
  const sourceUrl = String(raw.url || `https://remoteok.com/l/${raw.id}`);
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 40) : [];
  const min = Number(raw.salary_min) || 0;
  const max = Number(raw.salary_max) || 0;
  const salary = min || max;
  return {
    title,
    company,
    location: String(raw.location || "Remote").slice(0, 200),
    structuredLocation: { remoteScope: "unknown" },
    remoteType: "remote",
    salaryRange: { min, max, currency: salary ? "USD" : "" },
    compensation: { originalText: salary ? `${min || max}–${max || min} USD` : "", currency: salary ? "USD" : "", payPeriod: "unknown", min: salary ? min : null, max: salary ? max : null },
    requirements: tags,
    tags,
    rawDescription: sourceDescriptionText(raw.description || `${title} at ${company}`),
    sourceBoard: "remoteok",
    sourceJobId: String(raw.id),
    sourceUrl,
    canonicalUrl: sourceUrl,
    postedAt: raw.date ? new Date(raw.date) : null,
  };
}

export class RemoteOkAdapter extends BaseJobAdapter {
  constructor(options = {}) {
    super({ key: "remoteok", displayName: "Remote OK", capabilities: { paging: false, conditionalRequests: true, fields: ["title", "company", "location", "tags", "description", "salary", "postedAt", "sourceUrl"] }, ...options });
  }

  async fetchPage({ etag, lastModified } = {}) {
    const headers = {};
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;
    const result = await this.requestJson("https://remoteok.com/api", { headers, acceptNotModified: true });
    if (result.notModified) return { ...result, done: true };
    const items = Array.isArray(result.data) ? result.data.slice(1) : [];
    return {
      jobs: items.map(normalizeRemoteOkJob).filter(Boolean),
      etag: result.etag,
      lastModified: result.lastModified,
      done: true,
      cursor: null,
    };
  }
}

export default RemoteOkAdapter;
