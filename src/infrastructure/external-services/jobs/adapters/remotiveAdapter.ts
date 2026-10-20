import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

export interface NormalizedRemotiveJob {
  title: string;
  company: string;
  location: string;
  structuredLocation: { remoteScope: string; eligibleCountryCodes: string[] };
  remoteType: string;
  salaryRange: { min: number; max: number; currency: string };
  compensation: {
    originalText: string;
    currency: string;
    payPeriod: string;
  };
  requirements: string[];
  tags: string[];
  occupationCodes: string[];
  rawDescription: string;
  sourceBoard: string;
  sourceJobId: string;
  sourceUrl: string;
  canonicalUrl: string;
  postedAt: Date | null;
  sourceExpiresAt: Date | null;
}

export function normalizeRemotiveJob(
  raw: Record<string, unknown> | null | undefined,
): NormalizedRemotiveJob | null {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title || "").trim();
  const company = String(raw.company_name || raw.company || "").trim();
  const sourceJobId = raw.id === null || raw.id === undefined ? "" : String(raw.id);
  const sourceUrl = String(raw.url || "");
  if (!title || !company || !sourceJobId || !sourceUrl) return null;
  const location = String(raw.candidate_required_location || raw.category || "Remote").slice(
    0,
    200,
  );
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 40) : [];
  const occupationCodes = raw.category
    ? [
        `remotive:${String(raw.category)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}`,
      ]
    : [];

  return {
    title,
    company,
    location,
    structuredLocation: { remoteScope: "unknown", eligibleCountryCodes: [] },
    remoteType: "remote",
    salaryRange: { min: 0, max: 0, currency: "" },
    compensation: {
      originalText: String(raw.salary || "").slice(0, 200),
      currency: "",
      payPeriod: "unknown",
    },
    requirements: tags,
    tags,
    occupationCodes,
    rawDescription: sourceDescriptionText(
      raw.description || raw.job_description || `${title} at ${company}`,
    ),
    sourceBoard: "remotive",
    sourceJobId,
    sourceUrl,
    canonicalUrl: sourceUrl,
    postedAt: raw.publication_date ? new Date(String(raw.publication_date)) : null,
    sourceExpiresAt: raw.expiration_date ? new Date(String(raw.expiration_date)) : null,
  };
}

export class RemotiveAdapter extends BaseJobAdapter {
  constructor(options: Record<string, unknown> = {}) {
    super({
      key: "remotive",
      displayName: "Remotive",
      intervalMs: 21600000,
      capabilities: {
        paging: false,
        conditionalRequests: true,
        demandSearch: true,
        fields: [
          "title",
          "company",
          "location",
          "category",
          "tags",
          "description",
          "salary",
          "postedAt",
          "sourceUrl",
        ],
      },
      ...options,
    });
  }

  async fetchPage({
    etag,
    lastModified,
    demandTerm,
  }: {
    etag?: string | null;
    lastModified?: string | null;
    demandTerm?: string;
  } = {}): Promise<{
    jobs?: NormalizedRemotiveJob[];
    etag?: string | null;
    lastModified?: string | null;
    done: boolean;
    cursor?: string | null;
    notModified?: boolean;
  }> {
    const url = new URL("https://remotive.com/api/remote-jobs");
    if (demandTerm) url.searchParams.set("search", demandTerm.slice(0, 50));
    const headers: Record<string, string> = {};
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const result = await this.requestJson<{ jobs?: Array<Record<string, unknown>> }>(
      url.toString(),
      {
        headers,
        acceptNotModified: true,
      },
    );

    if (result.notModified) return { notModified: true, done: true, jobs: [] };
    const rawJobs = Array.isArray(result.data?.jobs) ? result.data.jobs : [];
    return {
      jobs: rawJobs.map(normalizeRemotiveJob).filter((j): j is NormalizedRemotiveJob => j !== null),
      etag: result.etag,
      lastModified: result.lastModified,
      done: true,
      cursor: null,
    };
  }
}

export default RemotiveAdapter;
