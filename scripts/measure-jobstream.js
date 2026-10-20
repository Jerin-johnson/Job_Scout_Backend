import {
  normalizeJobStreamEvent,
  parseJsonLines,
} from "../src/infrastructure/external-services/jobs/adapters/jobStreamAdapter.js";

const url = process.env.JOBSTREAM_SNAPSHOT_URL || "https://jobstream.api.jobtechdev.se/v2/snapshot";
const requestCap = 1;
const rowCap = Math.min(
  250000,
  Math.max(1, Number(process.env.JOBSTREAM_MEASURE_ROW_CAP || 250000)),
);
const byteCap = 256 * 1024 * 1024;
const timeLimitMs = 45 * 1000;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeLimitMs);
const startedAt = performance.now();
let requests = 0;
let bytes = 0;
let rowsRead = 0;
let active = 0;
let deletions = 0;
const fieldCounts = new Map();
let measurementError = null;

try {
  requests += 1;
  const response = await fetch(url, {
    headers: {
      Accept: "application/jsonl",
      "User-Agent": "JobScoutOpenDataMeasurement/1.0 (polite bounded local evaluation)",
    },
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`JobStream snapshot returned HTTP ${response.status}.`);
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("JobStream did not return a stream body.");
  async function* chunks() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > byteCap) {
          controller.abort();
          throw new Error("JobStream measurement stopped at the 256 MiB cap.");
        }
        yield value;
      }
    } finally {
      if (!controller.signal.aborted) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  for await (const raw of parseJsonLines(chunks())) {
    rowsRead += 1;
    for (const key of Object.keys(raw)) fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
    const event = normalizeJobStreamEvent(raw);
    if (event?.type === "upsert") active += 1;
    else if (event?.type === "delete") deletions += 1;
    if (rowsRead >= rowCap || performance.now() - startedAt >= timeLimitMs) {
      controller.abort();
      break;
    }
  }
} catch (error) {
  measurementError =
    error?.name === "AbortError"
      ? "Request exceeded the 45-second measurement limit."
      : error?.cause?.code
        ? `Network failure: ${error.cause.code}.`
        : "Snapshot request failed.";
} finally {
  clearTimeout(timeout);
}
console.log(
  JSON.stringify(
    {
      source: "JobStream v2 snapshot",
      requests,
      requestCap,
      rowsRead,
      activeJobsReachable: active,
      deletionEvents: deletions,
      bytes,
      elapsedMs: Math.round(performance.now() - startedAt),
      fieldPresence: Object.fromEntries([...fieldCounts].sort(([a], [b]) => a.localeCompare(b))),
      capped:
        rowsRead >= rowCap || bytes >= byteCap || performance.now() - startedAt >= timeLimitMs,
      error: measurementError,
      limitations:
        "The API exposes a streaming snapshot rather than cursor-paged pages. Counts cover only records successfully streamed. No records were written to MongoDB.",
    },
    null,
    2,
  ),
);
