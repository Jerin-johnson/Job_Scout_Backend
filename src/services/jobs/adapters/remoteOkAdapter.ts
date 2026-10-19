import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

export interface NormalizedRemoteOkJob {
  title: string;
  company: string;
  location: string;
  structuredLocation: { remoteScope: string };
  remoteType: string;
  salaryRange: { min: number; max: number; currency: string };
  compensation: {
    originalText: string;
    currency: string;
    payPeriod: string;
    min: number | null;
    max: number | null;
  };
  requirements: string[];
  tags: string[];
  rawDescription: string;
  sourceBoard: string;
  sourceJobId: string;
  sourceUrl: string;
  canonicalUrl: string;
  postedAt: Date | null;
}

export function normalizeRemoteOkJob(raw: Record<string, unknown> | null | undefined): NormalizedRemoteOkJob | null {
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
    compensation: {
      originalText: salary ? `${min || max}–${max || min} USD` : "",
      currency: salary ? "USD" : "",
      payPeriod: "unknown",
      min: salary ? min : null,
      max: salary ? max : null,
    },
    requirements: tags,
    tags,
    rawDescription: sourceDescriptionText(raw.description || `${title} at ${company}`),
    sourceBoard: "remoteok",
    sourceJobId: String(raw.id),
    sourceUrl,
    canonicalUrl: sourceUrl,
    postedAt: raw.date ? new Date(String(raw.date)) : null,
  };
}

export class RemoteOkAdapter extends BaseJobAdapter {
  constructor(options: Record<string, unknown> = {}) {
    super({
      key: "remoteok",
      displayName: "Remote OK",
      capabilities: {
        paging: false,
        conditionalRequests: true,
        fields: ["title", "company", "location", "tags", "description", "salary", "postedAt", "sourceUrl"],
      },
      ...options,
    });
  }

  async fetchPage({ etag, lastModified }: { etag?: string | null; lastModified?: string | null } = {}): Promise<{
    jobs?: NormalizedRemoteOkJob[];
    etag?: string | null;
    lastModified?: string | null;
    done: boolean;
    cursor?: string | null;
    notModified?: boolean;
  }> {
    const headers: Record<string, string> = {};
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const result = await this.requestJson<Array<Record<string, unknown>>>("https://remoteok.com/api", {
      headers,
      acceptNotModified: true,
    });

    if (result.notModified) return { notModified: true, done: true, jobs: [] };
    const items = Array.isArray(result.data) ? result.data.slice(1) : [];
    return {
      jobs: items.map(normalizeRemoteOkJob).filter((j): j is NormalizedRemoteOkJob => j !== null),
      etag: result.etag,
      lastModified: result.lastModified,
      done: true,
      cursor: null,
    };
  }
}

export default RemoteOkAdapter;
