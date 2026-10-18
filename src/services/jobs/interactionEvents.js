import { createHash } from "node:crypto";
import { InteractionEvent } from "../../models/InteractionEvent.js";

const ALLOWED_EVENTS = new Set(["impression", "zero_result", "click", "save", "apply_click", "hide", "match_feedback", "resume_match_used"]);
export const JOB_ANALYTICS_CONSENT_VERSION = "job-analytics-v1";

export function interactionActorKey(userId) {
  return createHash("sha256").update(`jobscout-interaction-v1:${String(userId)}`).digest("hex");
}

export async function recordInteraction({ userId, consented = false, event, count = 1, source, occupation, country, scoreBand } = {}) {
  if (!userId || !consented || !ALLOWED_EVENTS.has(event)) return null;
  try {
    return await InteractionEvent.create({
      actorKey: interactionActorKey(userId), event,
      count: Math.max(1, Math.min(500, Math.trunc(Number(count) || 1))),
      source: /^[a-z0-9_-]{1,40}$/i.test(source || "") ? source : "unknown",
      occupation: /^[a-z0-9_-]{1,40}$/i.test(occupation || "") ? occupation : "unknown",
      country: /^[A-Z]{2}$/.test(country || "") ? country : "unknown",
      scoreBand: ["strong", "good", "fair", "low"].includes(scoreBand) ? scoreBand : "unknown",
    });
  } catch { return null; }
}

export async function recordImpressions(userId, jobs = [], consented = false) {
  if (!consented) return;
  const groups = new Map();
  for (const job of jobs.slice(0, 50)) {
    const key = [job.sourceBoard || "unknown", job.occupation || "unknown", job.structuredLocation?.countryCode || "unknown", job.scoreBand || "unknown"].join("|");
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  await Promise.all([...groups.entries()].map(([key, count]) => {
    const [source, occupation, country, scoreBand] = key.split("|");
    return recordInteraction({ userId, consented, event: "impression", count, source, occupation, country, scoreBand });
  }));
}
