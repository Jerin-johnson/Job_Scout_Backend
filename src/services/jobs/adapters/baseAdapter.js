import { computeSha256 } from "../../../shared/utils/crypto.js";

/**
 * Base Job Board Adapter Interface
 */
export class BaseJobAdapter {
  constructor(name, enabled = true) {
    this.name = name;
    this.enabled = enabled;
  }

  /**
   * Generates a deterministic SHA256 content hash from title, company, and location
   */
  generateContentHash({ title, company, location }) {
    const normalized = `${title.toLowerCase().trim()}:${company.toLowerCase().trim()}:${(location || "remote").toLowerCase().trim()}`;
    return computeSha256(normalized);
  }

  /**
   * Abstract method: override in child adapters
   */
  async fetchJobs() {
    throw new Error("fetchJobs must be implemented by child adapter");
  }
}
