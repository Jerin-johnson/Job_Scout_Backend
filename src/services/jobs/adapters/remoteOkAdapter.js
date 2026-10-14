import { BaseJobAdapter } from "./baseAdapter.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../shared/utils/logger.js";

export class RemoteOkAdapter extends BaseJobAdapter {
  constructor() {
    super("remoteok", env.ENABLE_REMOTEOK_INGESTION);
  }

  async fetchJobs() {
    if (!this.enabled) {
      return [];
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch("https://remoteok.com/api", {
        headers: { "User-Agent": "JobScoutAgent/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        logger.warn({ status: res.status }, "RemoteOK fetch returned non-200");
        return [];
      }

      const data = await res.json();
      // First item in RemoteOK is a legal notice/disclaimer object, not a job
      const rawJobs = Array.isArray(data) ? data.slice(1, 20) : [];

      return rawJobs
        .filter((j) => j && j.position && j.company)
        .map((j) => {
          const title = j.position;
          const company = j.company;
          const location = j.location || "Remote";

          return {
            title,
            company,
            location,
            remoteType: "remote",
            salaryRange: {
              min: j.salary_min || 0,
              max: j.salary_max || 0,
              currency: "USD",
            },
            requirements: j.tags || [],
            tags: j.tags || [],
            rawDescription: j.description || `${title} at ${company}`,
            sourceBoard: this.name,
            sourceUrl: j.url || `https://remoteok.com/l/${j.id}`,
            contentHash: this.generateContentHash({ title, company, location }),
            postedAt: j.date ? new Date(j.date) : new Date(),
          };
        });
    } catch (err) {
      logger.warn({ err: err.message }, "RemoteOK ingestion failed; skipped");
      return [];
    }
  }
}
