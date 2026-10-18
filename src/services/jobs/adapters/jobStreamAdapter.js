import { BaseJobAdapter, sourceDescriptionText } from "./baseAdapter.js";

const ACTIVE_STATES = new Set(["active", "published", "open", "updated", "created", "upsert", "insert", "modify", "modified"]);
const DELETED_STATES = new Set(["deleted", "delete", "closed", "inactive", "removed", "expired", "withdrawn", "unpublished", "unpublish"]);

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function text(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") return String(firstValue(value.label, value.name, value.value, value.text) || "").trim();
  return "";
}

function stateOf(value) {
  const type = String(value?.type || "").toLowerCase();
  const eventType = firstValue(value?.eventType, value?.changeType, value?.operation,
    (ACTIVE_STATES.has(type) || DELETED_STATES.has(type) || /(?:created|updated|published|upsert|insert|modify|deleted|delete|inactive|closed|removed|expired|withdrawn|unpublish)/i.test(type)) ? type : null,
    value?.status, value?.state) || "active";
  return String(eventType)
    .toLowerCase().replace(/[^a-z]+/g, "");
}

function eventCursor(value) {
  const changedAt = firstValue(value.changedAt, value.modifiedAt, value.updatedAt, value.timestamp, value.eventTimestamp, value.job?.modifiedAt, value.job?.updatedAt, value.ad?.modifiedAt, value.ad?.updatedAt);
  return changedAt && !Number.isNaN(new Date(changedAt).getTime()) ? new Date(changedAt).toISOString() : null;
}

function sourceIdOf(value) {
  const id = firstValue(value?.sourceJobId, value?.id, value?.adId, value?.externalId, value?.annonsId, value?.job?.id, value?.ad?.id);
  return id === undefined ? "" : String(id).trim();
}

export function normalizeJobStreamJob(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = sourceIdOf(raw);
  const title = text(firstValue(raw.headline, raw.title, raw.jobTitle, raw.occupation?.label, raw.occupation?.name));
  const company = text(firstValue(raw.employer?.name, raw.employerName, raw.company?.name, raw.company));
  const sourceUrl = text(firstValue(raw.webpageUrl, raw.url, raw.applicationUrl, raw.applicationDetails?.url));
  if (!id || !title || !company || !sourceUrl) return null;

  const locationParts = [
    text(raw.workplaceAddress?.municipality), text(raw.workplaceAddress?.city),
    text(raw.workplaceAddress?.region), text(raw.workplaceAddress?.country),
  ].filter(Boolean);
  const location = text(firstValue(raw.location, raw.workplaceAddress?.label, locationParts.join(", "), raw.workplaceAddress)) || "Sweden";
  const postedAtRaw = firstValue(raw.publicationDate, raw.publishedAt, raw.createdAt, raw.datePosted);
  const postedAt = postedAtRaw ? new Date(postedAtRaw) : null;
  const description = text(firstValue(raw.description?.text, raw.description, raw.plainText, raw.descriptionText));
  const categories = [raw.occupation?.label, raw.occupation?.name, raw.occupationGroup?.label, raw.occupationGroup?.name, raw.category?.label, raw.category?.name]
    .map(text).filter(Boolean);
  return {
    sourceJobId: id,
    title,
    company,
    location: location.slice(0, 200),
    structuredLocation: { countryCode: "SE", remoteScope: "unknown" },
    remoteType: "onsite",
    sourceUrl,
    canonicalUrl: sourceUrl,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    rawDescription: sourceDescriptionText(description || `${title} at ${company}`),
    sourceCategory: categories.join(" / ").slice(0, 160),
    tags: categories.slice(0, 20),
    requirements: [],
    salaryRange: { min: 0, max: 0, currency: "" },
    compensation: { originalText: text(raw.salary?.description || raw.salary?.label || raw.salary), currency: "", payPeriod: "unknown" },
  };
}

/**
 * Normalize JobStream v2 snapshot rows and stream change events. A removal is
 * represented explicitly so the worker can immediately close/delete the source
 * listing instead of applying ordinary retention to an inactive ad.
 */
export function normalizeJobStreamEvent(value) {
  if (!value || typeof value !== "object") return null;
  const id = sourceIdOf(value);
  if (!id) return null;
  const state = stateOf(value);
  if (DELETED_STATES.has(state) || /(?:deleted|delete|inactive|closed|removed|expired|withdrawn|unpublish)/.test(state) || value.deleted === true || value.isActive === false || value.active === false) {
    return { type: "delete", sourceJobId: id, cursor: eventCursor(value) };
  }
  if (!ACTIVE_STATES.has(state) && !/(?:updated|created|published|upsert|insert|modify)/.test(state)) return null;
  const job = normalizeJobStreamJob(value.job || value.ad || value.data || value);
  return job ? { type: "upsert", sourceJobId: id, job, cursor: eventCursor(value) } : null;
}

/** Incrementally parse newline-delimited JSON from a Node/Web async stream. */
export async function* parseJsonLines(chunks) {
  const decoder = new TextDecoder();
  let pending = "";
  let lineNumber = 0;
  for await (const chunk of chunks) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      lineNumber += 1;
      if (!line.trim()) continue;
      try { yield JSON.parse(line); }
      catch { throw new Error(`Invalid JobStream JSONL at line ${lineNumber}.`); }
    }
  }
  pending += decoder.decode();
  if (pending.trim()) {
    lineNumber += 1;
    try { yield JSON.parse(pending); }
    catch { throw new Error(`Invalid JobStream JSONL at line ${lineNumber}.`); }
  }
}

export class JobStreamAdapter extends BaseJobAdapter {
  constructor(options = {}) {
    super({ key: "jobstream-se", displayName: "Sweden JobStream", intervalMs: 6 * 60 * 60 * 1000, timeoutMs: 30000, maxRetries: 0, capabilities: { streaming: true, snapshots: true, changeEvents: true, deletions: true, fields: ["title", "company", "location", "occupation", "description", "postedAt", "sourceUrl"] }, ...options });
    this.snapshotUrl = options.snapshotUrl || process.env.JOBSTREAM_SNAPSHOT_URL || "https://jobstream.api.jobtechdev.se/v2/snapshot";
    this.changesUrl = options.changesUrl || process.env.JOBSTREAM_CHANGES_URL || "https://jobstream.api.jobtechdev.se/v2/stream";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async *iterateJsonl(url, { signal, cursor, until } = {}) {
    if (!url) throw new Error("JobStream snapshot/change URL is not configured.");
    if (this.consumeQuota) await this.consumeQuota();
    const requestUrl = new URL(url);
    if (cursor) requestUrl.searchParams.set("updated-after", cursor);
    if (until) requestUrl.searchParams.set("updated-before", until);
    const response = await this.fetchImpl(requestUrl, {
      headers: { Accept: "application/jsonl", "User-Agent": "JobScoutJobCatalog/1.0 (+https://jobscout.ai)" },
      signal,
    });
    if (!response.ok) throw new Error(`JobStream returned HTTP ${response.status}.`);
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") throw new Error("JobStream response does not expose a streaming body.");
    for await (const item of parseJsonLines(response.body)) yield item;
  }

  async *iterateSnapshot(options = {}) {
    for await (const row of this.iterateJsonl(options.url || this.snapshotUrl, options)) {
      const event = normalizeJobStreamEvent(row);
      if (event?.type === "upsert") yield event.job;
    }
  }

  async *iterateChanges(options = {}) {
    for await (const row of this.iterateJsonl(options.url || this.changesUrl, options)) {
      const event = normalizeJobStreamEvent(row);
      if (event) yield event;
    }
  }

  // Generic ingestion consumes bounded pages. Keep this adapter's default page
  // intentionally explicit rather than buffering a full snapshot into memory.
  async fetchPage({ cursor = null } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const state = { cursor: cursor || new Date().toISOString() };
    const adapter = this;
    const windowEnd = new Date().toISOString();
    async function* events() {
      try {
        if (cursor) {
          for await (const event of adapter.iterateChanges({ signal: controller.signal, cursor, until: windowEnd })) {
            if (event.cursor && (!state.cursor || event.cursor > state.cursor)) state.cursor = event.cursor;
            yield event;
          }
        } else {
          for await (const raw of adapter.iterateJsonl(adapter.snapshotUrl, { signal: controller.signal })) {
            const event = normalizeJobStreamEvent(raw);
            if (event?.type === "upsert") {
              if (event.cursor && event.cursor > state.cursor) state.cursor = event.cursor;
              yield event;
            }
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }
    return {
      events: events(),
      get cursor() { return state.cursor; },
      done: true,
    };
  }
}

export default JobStreamAdapter;
