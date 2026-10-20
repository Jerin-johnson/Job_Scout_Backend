import { computeSha256 } from "../../../../shared/utils/crypto.js";
import { computeRetryBackoffMs } from "../../../database/mongoose/services/ingestionResilienceService.js";

export function sourceDescriptionText(value: unknown): string {
  return String(value || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim()
    .slice(0, 24000);
}

export function normalizeCanonicalJobUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_[a-z]+|ref|source|tracking|trk|campaign|gh_src)$/i.test(key))
        url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export interface BaseJobAdapterOptions {
  key?: string;
  displayName?: string;
  capabilities?: Record<string, unknown>;
  intervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffBaseMs?: number;
}

export interface JobIdentityParams {
  source?: string;
  sourceJobId?: string | number;
  canonicalUrl?: string;
  title?: string;
  company?: string;
  location?: string;
}

export interface JobGroupKeyParams {
  canonicalUrl?: string;
  company?: string;
  title?: string;
  location?: string;
  employmentType?: string;
  postedAt?: Date | string | number | null;
}

export interface JobRecordLike {
  identityKey?: string;
  title?: string;
  company?: string;
  location?: string;
  structuredLocation?: Record<string, unknown>;
  remoteType?: string;
  salaryRange?: unknown;
  compensation?: unknown;
  requirements?: string[];
  tags?: string[];
  occupationCodes?: string[];
  rawDescription?: string;
  sourceUrl?: string;
  canonicalUrl?: string;
  postedAt?: Date | string;
  sourceExpiresAt?: Date | string;
  [key: string]: unknown;
}

export interface RequestJsonOptions {
  headers?: Record<string, string>;
  acceptNotModified?: boolean;
  method?: string;
  body?: string;
}

export interface RequestJsonResponse<T = unknown> {
  data?: T;
  notModified?: boolean;
  jobs?: unknown[];
  etag?: string | null;
  lastModified?: string | null;
}

export class BaseJobAdapter {
  name: string;
  displayName: string;
  capabilities: Readonly<Record<string, unknown>>;
  intervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffBaseMs: number;
  enabled: boolean;
  consumeQuota: (() => Promise<void>) | null;

  constructor({
    key = "",
    displayName = "",
    capabilities = {},
    intervalMs = 86400000,
    timeoutMs = 10000,
    maxRetries = 2,
    retryBackoffBaseMs = 300,
  }: BaseJobAdapterOptions = {}) {
    this.name = key;
    this.displayName = displayName || key;
    this.capabilities = Object.freeze(capabilities);
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryBackoffBaseMs = retryBackoffBaseMs;
    this.enabled = true;
    this.consumeQuota = null;
  }

  generateIdentity({
    source = this.name,
    sourceJobId,
    canonicalUrl,
    title,
    company,
    location,
  }: JobIdentityParams): string {
    const sourceId = String(sourceJobId || "").trim();
    const url = normalizeCanonicalJobUrl(canonicalUrl);
    const normalize = (value: unknown) =>
      String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
    const fallback = `${normalize(company)}|${normalize(title)}|${normalize(location) || "unknown"}`;
    return computeSha256(
      sourceId ? `${source}:${sourceId}` : url ? `${source}:${url}` : `${source}:${fallback}`,
    );
  }

  generateGroupKey({
    canonicalUrl,
    company,
    title,
    location,
    employmentType = "",
    postedAt = null,
  }: JobGroupKeyParams): string {
    const url = normalizeCanonicalJobUrl(canonicalUrl);
    if (url) return computeSha256(`canonical:${url}`);
    const normalize = (value: unknown) =>
      String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    const postedDay = postedAt ? new Date(postedAt).toISOString().slice(0, 10) : "unknown-date";
    const entity = [company, title, location, employmentType, postedDay].map(normalize).join("|");
    return entity.replaceAll("|", "") ? computeSha256(`entity:${entity}`) : "";
  }

  generateContentHash(job: JobRecordLike): string {
    const embeddingText = `${job.title} at ${job.company}. Requirements: ${(job.requirements || []).join(", ")}. ${String(job.rawDescription || "").slice(0, 500)}`;
    return computeSha256(`${job.identityKey || this.name}:${embeddingText}`);
  }

  generateRecordHash(job: JobRecordLike): string {
    const relevant = {
      title: job.title,
      company: job.company,
      location: job.location,
      structuredLocation: job.structuredLocation,
      remoteType: job.remoteType,
      salaryRange: job.salaryRange,
      compensation: job.compensation,
      requirements: job.requirements,
      tags: job.tags,
      occupationCodes: job.occupationCodes,
      rawDescription: String(job.rawDescription || "").slice(0, 24000),
      sourceUrl: job.sourceUrl,
      canonicalUrl: job.canonicalUrl,
      postedAt: job.postedAt,
      sourceExpiresAt: job.sourceExpiresAt,
    };
    return computeSha256(`${job.identityKey || this.name}:${JSON.stringify(relevant)}`);
  }

  generateLegacyContentHash(job: JobRecordLike): string {
    const relevant = {
      title: job.title,
      company: job.company,
      location: job.location,
      requirements: job.requirements,
      tags: job.tags,
      rawDescription: String(job.rawDescription || "").slice(0, 500),
    };
    return computeSha256(`${job.identityKey || this.name}:${JSON.stringify(relevant)}`);
  }

  async requestJson<T = unknown>(
    url: string,
    { headers = {}, acceptNotModified = false, method = "GET", body }: RequestJsonOptions = {},
  ): Promise<RequestJsonResponse<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (this.consumeQuota) await this.consumeQuota();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: { "User-Agent": "JobScoutJobCatalog/1.0 (+https://jobscout.ai)", ...headers },
          ...(body === undefined ? {} : { body }),
          signal: controller.signal,
        });
      } catch (error: unknown) {
        lastError = error;
        // Abort timeouts are not retried; other network failures get bounded retries.
        if ((error as Error).name === "AbortError" || attempt >= this.maxRetries) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, computeRetryBackoffMs(attempt, { baseMs: this.retryBackoffBaseMs })),
        );
        continue;
      } finally {
        clearTimeout(timeoutId);
      }
      if (response.status === 304 && acceptNotModified) {
        return {
          notModified: true,
          jobs: [],
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        };
      }
      if (!response.ok) {
        const error = new Error(`Source returned HTTP ${response.status}`) as Error & {
          status?: number;
        };
        error.status = response.status;
        if (!(response.status === 429 || response.status >= 500) || attempt >= this.maxRetries)
          throw error;
        lastError = error;
        await new Promise((resolve) =>
          setTimeout(resolve, computeRetryBackoffMs(attempt, { baseMs: this.retryBackoffBaseMs })),
        );
        continue;
      }
      return {
        data: (await response.json()) as T,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    }
    throw lastError;
  }

  async fetchPage(_cursor?: unknown): Promise<unknown> {
    throw new Error("fetchPage must be implemented by a source adapter");
  }
}
