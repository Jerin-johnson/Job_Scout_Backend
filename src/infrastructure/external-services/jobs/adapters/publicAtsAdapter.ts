import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";
import { TrackedCompany } from "../../../database/mongoose/models/TrackedCompanyModel.js";

export interface NormalizedPublicAtsJob {
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  postedAt: Date | null;
  rawDescription: string;
  tags: string[];
}

export function normalizePublicAtsJob(
  platform: string,
  slug: string,
  raw: Record<string, unknown> | null | undefined,
): NormalizedPublicAtsJob | null {
  if (platform === "ashby" && raw?.isListed !== true) return null;
  if (platform === "greenhouse") {
    const loc = raw?.location as { name?: string } | undefined;
    return {
      sourceJobId: String(raw?.id),
      title: String(raw?.title || ""),
      company: slug,
      location: loc?.name || "Unspecified",
      sourceUrl: String(raw?.absolute_url || ""),
      postedAt: raw?.updated_at ? new Date(String(raw.updated_at)) : null,
      rawDescription: sourceDescriptionText(raw?.content),
      tags: [
        ...((raw?.departments as Array<{ name?: string }>) || []).map((item) => item.name || ""),
        ...((raw?.offices as Array<{ name?: string }>) || []).map((item) => item.name || ""),
      ]
        .filter(Boolean)
        .slice(0, 30),
    };
  }
  if (platform === "lever") {
    const cats = raw?.categories as
      { location?: string; team?: string; department?: string; commitment?: string } | undefined;
    return {
      sourceJobId: String(raw?.id),
      title: String(raw?.text || ""),
      company: slug,
      location: cats?.location || "Unspecified",
      sourceUrl: String(raw?.hostedUrl || ""),
      postedAt: raw?.createdAt ? new Date(String(raw.createdAt)) : null,
      rawDescription: sourceDescriptionText(raw?.descriptionPlain),
      tags: [cats?.team, cats?.department, cats?.commitment]
        .filter((t): t is string => Boolean(t))
        .slice(0, 30),
    };
  }
  return {
    sourceJobId: String(raw?.id),
    title: String(raw?.title || ""),
    company: slug,
    location: String(raw?.location || "Unspecified"),
    sourceUrl: String(raw?.jobUrl || ""),
    postedAt: raw?.publishedAt ? new Date(String(raw.publishedAt)) : null,
    rawDescription: sourceDescriptionText(raw?.descriptionPlain || raw?.description),
    tags: [raw?.department, raw?.team].filter((t): t is string => Boolean(t)).slice(0, 30),
  };
}

export interface PublicAtsAdapterOptions {
  key?: string;
  intervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  requestsPerDay?: number | string;
  [key: string]: unknown;
}

export class PublicAtsAdapter extends BaseJobAdapter {
  platform: string;
  requestsPerRun: number;

  constructor(options: PublicAtsAdapterOptions = {}) {
    super({
      key: options.key,
      displayName: options.key,
      intervalMs: options.intervalMs || 86400000,
      timeoutMs: options.timeoutMs || 8000,
      maxRetries: options.maxRetries ?? 1,
      capabilities: {
        paging: true,
        listedOnly: options.key === "ashby",
        conditionalRequests: false,
        fields: ["title", "location", "description", "postedAt", "sourceUrl"],
      },
    });
    this.platform = options.key || "";
    this.requestsPerRun = Math.min(50, Math.max(1, Number(options.requestsPerDay) || 10));
  }

  endpoint(slug: string): string {
    if (this.platform === "greenhouse")
      return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
    if (this.platform === "lever")
      return `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
    return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=false`;
  }

  async fetchBoard(slug: string): Promise<NormalizedPublicAtsJob[]> {
    if (this.platform !== "ashby") {
      const response = await this.requestJson<
        Record<string, unknown> | Array<Record<string, unknown>>
      >(this.endpoint(slug), { acceptNotModified: false });
      const records =
        this.platform === "greenhouse"
          ? (response.data as { jobs?: Array<Record<string, unknown>> })?.jobs
          : (response.data as Array<Record<string, unknown>>);
      return (Array.isArray(records) ? records : [])
        .map((record) => normalizePublicAtsJob(this.platform, slug, record))
        .filter((job): job is NormalizedPublicAtsJob =>
          Boolean(job && job.title && job.sourceJobId && job.sourceUrl),
        );
    }
    const response = await this.requestJson<{ jobs?: Array<Record<string, unknown>> }>(
      this.endpoint(slug),
      {
        acceptNotModified: false,
      },
    );
    return (response.data?.jobs || [])
      .map((record) => normalizePublicAtsJob("ashby", slug, record))
      .filter((job): job is NormalizedPublicAtsJob =>
        Boolean(job && job.title && job.sourceJobId && job.sourceUrl),
      );
  }

  async fetchPage({ cursor }: { cursor?: string | null } = {}): Promise<{
    jobs: NormalizedPublicAtsJob[];
    cursor: string | null;
    done: boolean;
  }> {
    const companies = (await TrackedCompany.find({ platform: this.platform, status: "approved" })
      .sort({ _id: 1 })
      .select("slug")
      .lean()) as unknown as Array<{ slug: string }>;
    const start = Math.min(companies.length, Math.max(0, Number.parseInt(cursor || "0", 10) || 0));
    const budget = this.requestsPerRun;
    const end = Math.min(companies.length, start + budget);
    const jobs: NormalizedPublicAtsJob[] = [];
    for (const company of companies.slice(start, end)) {
      jobs.push(...(await this.fetchBoard(company.slug)));
    }
    return {
      jobs,
      cursor: end < companies.length ? String(end) : null,
      done: end >= companies.length,
    };
  }
}

export default PublicAtsAdapter;
