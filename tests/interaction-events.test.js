import test from "node:test";
import assert from "node:assert/strict";
import {
  interactionActorKey,
  recordInteraction,
  JOB_ANALYTICS_CONSENT_VERSION,
} from "../src/infrastructure/database/mongoose/services/interactionEvents.js";
import { buildSourceStatusUpdate } from "../src/infrastructure/database/mongoose/services/jobIngestionService.js";

test("interaction actor keys are stable pseudonyms and never the account ID", () => {
  const id = "507f1f77bcf86cd799439011";
  const first = interactionActorKey(id);
  assert.equal(first, interactionActorKey(id));
  assert.notEqual(first, id);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("interaction collection is opt-in and uses a dedicated consent version", async () => {
  assert.equal(JOB_ANALYTICS_CONSENT_VERSION, "job-analytics-v1");
  assert.equal(
    await recordInteraction({ userId: "507f1f77bcf86cd799439011", event: "click" }),
    null,
  );
});

test("source status keeps confirmed active listings fresh, hides unknown, and closes closed", () => {
  const checkedAt = new Date("2026-10-18T12:00:00.000Z");
  const active = buildSourceStatusUpdate("active", checkedAt, 7);
  assert.equal(active.status, "active");
  assert.equal(active.expiresAt.toISOString(), "2026-10-25T12:00:00.000Z");
  assert.equal(buildSourceStatusUpdate("unknown", checkedAt, 7).status, "stale");
  assert.equal(buildSourceStatusUpdate("closed", checkedAt, 7).status, "closed");
});
