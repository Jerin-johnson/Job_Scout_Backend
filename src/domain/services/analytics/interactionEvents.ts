import { createHash } from "node:crypto";

export const ALLOWED_EVENTS = new Set([
  "impression",
  "zero_result",
  "click",
  "save",
  "apply_click",
  "hide",
  "match_feedback",
  "resume_match_used",
]);

export const JOB_ANALYTICS_CONSENT_VERSION = "job-analytics-v1";

export function interactionActorKey(userId: string | unknown): string {
  return createHash("sha256")
    .update(`jobscout-interaction-v1:${String(userId)}`)
    .digest("hex");
}
