import { computeSha256 } from "../../../shared/utils/crypto.js";

export function sourceDescriptionText(value) {
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

export class BaseJobAdapter {
  constructor({ key, displayName, capabilities, intervalMs = 86400000, timeoutMs = 10000, maxRetries = 2 } = {}) {
    this.name = key;
    this.displayName = displayName || key;
    this.capabilities = Object.freeze(capabilities || {});
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.enabled = true;
    this.consumeQuota = null;
  }

  generateIdentity({ source = this.name, sourceJobId, canonicalUrl, title, company, location }) {
    const sourceId = String(sourceJobId || "").trim();
    const url = String(canonicalUrl || "").trim().toLowerCase().replace(/\/$/, "");
    const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
    const fallback = `${normalize(company)}|${normalize(title)}|${normalize(location) || "unknown"}`;
    return computeSha256(sourceId ? `${source}:${sourceId}` : url ? `${source}:${url}` : `${source}:${fallback}`);
  }

  generateContentHash(job) {
    const embeddingText = `${job.title} at ${job.company}. Requirements: ${(job.requirements || []).join(", ")}. ${String(job.rawDescription || "").slice(0, 500)}`;
    return computeSha256(`${job.identityKey || this.name}:${embeddingText}`);
  }

  generateRecordHash(job) {
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

  generateLegacyContentHash(job) {
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

  async requestJson(url, { headers = {}, acceptNotModified = false, method = "GET", body } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (this.consumeQuota) await this.consumeQuota();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await fetch(url, {
          method,
          headers: { "User-Agent": "JobScoutJobCatalog/1.0 (+https://jobscout.ai)", ...headers },
          ...(body === undefined ? {} : { body }),
          signal: controller.signal,
        });
      } catch (error) {
        lastError = error;
        // Abort timeouts are not retried; other network failures get bounded retries.
        if (error.name === "AbortError" || attempt >= this.maxRetries) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(4000, 300 * 2 ** attempt)));
        continue;
      } finally {
        clearTimeout(timeoutId);
      }
      if (response.status === 304 && acceptNotModified) {
        return { notModified: true, jobs: [], etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
      }
      if (!response.ok) {
        const error = new Error(`Source returned HTTP ${response.status}`);
        error.status = response.status;
        if (!(response.status === 429 || response.status >= 500) || attempt >= this.maxRetries) throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(4000, 300 * 2 ** attempt)));
        continue;
      }
      return { data: await response.json(), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
    }
    throw lastError;
  }

  async fetchPage() {
    throw new Error("fetchPage must be implemented by a source adapter");
  }
}
