import test from "node:test";
import assert from "node:assert/strict";
import {
  INGESTION_ALERT_THRESHOLDS,
  appendDeadLetters,
  buildDeadLetterEntry,
  computeCircuitOpenUntil,
  computeRetryBackoffMs,
  evaluateSourceHealthAlerts,
  isIngestionShuttingDown,
  requestIngestionShutdown,
  resetIngestionShutdown,
  validateRawIngestJob,
} from "../src/infrastructure/database/mongoose/services/ingestionResilienceService.js";
import { BaseJobAdapter } from "../src/infrastructure/external-services/jobs/adapters/baseAdapter.js";

test("computeRetryBackoffMs applies bounded exponential backoff", () => {
  assert.equal(computeRetryBackoffMs(0, { baseMs: 300, maxMs: 4000 }), 300);
  assert.equal(computeRetryBackoffMs(1, { baseMs: 300, maxMs: 4000 }), 600);
  assert.equal(computeRetryBackoffMs(2, { baseMs: 300, maxMs: 4000 }), 1200);
  assert.equal(computeRetryBackoffMs(5, { baseMs: 300, maxMs: 4000 }), 4000);
});

test("computeCircuitOpenUntil opens circuit at threshold with exponential cooldown", () => {
  const now = new Date("2026-10-19T00:00:00.000Z");
  assert.equal(computeCircuitOpenUntil(4, { now }), null);
  const open5 = computeCircuitOpenUntil(5, { now });
  assert.equal(open5.toISOString(), "2026-10-19T00:05:00.000Z");
  const open6 = computeCircuitOpenUntil(6, { now });
  assert.equal(open6.toISOString(), "2026-10-19T00:10:00.000Z");
  const open12 = computeCircuitOpenUntil(12, { now });
  assert.equal(open12.toISOString(), "2026-10-19T01:00:00.000Z");
});

test("validateRawIngestJob and appendDeadLetters bound dead-letter queue entries", () => {
  assert.equal(validateRawIngestJob(null).reasonCode, "MALFORMED_RECORD");
  assert.equal(validateRawIngestJob({}).reasonCode, "MISSING_TITLE_AND_COMPANY");
  assert.equal(validateRawIngestJob({ company: "Acme" }).reasonCode, "MISSING_TITLE");
  assert.equal(validateRawIngestJob({ title: "Engineer" }).reasonCode, "MISSING_COMPANY");
  assert.equal(validateRawIngestJob({ title: "Engineer", company: "Acme" }).valid, true);

  const existing = Array.from({ length: 48 }, (_, idx) =>
    buildDeadLetterEntry({ sourceJobId: `id-${idx}`, reasonCode: "MISSING_TITLE" }),
  );
  const incoming = Array.from({ length: 5 }, (_, idx) =>
    buildDeadLetterEntry({ sourceJobId: `new-${idx}`, reasonCode: "MISSING_COMPANY" }),
  );
  const combined = appendDeadLetters(existing, incoming, 50);
  assert.equal(combined.length, 50);
  assert.equal(combined[0].sourceJobId, "id-3");
  assert.equal(combined.at(-1).sourceJobId, "new-4");
});

test("evaluateSourceHealthAlerts triggers critical and warning alerts at configured thresholds", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");
  const healthy = evaluateSourceHealthAlerts(
    {
      enabled: true,
      approved: true,
      runState: "healthy",
      lastSuccessAt: new Date("2026-10-19T11:00:00.000Z"),
      quota: { requestsPerDay: 24, intervalMs: 3600_000 },
      quotaUsed: 4,
      circuit: { failures: 0, openUntil: null },
      metrics: { deadLettered: 0 },
    },
    { now },
  );
  assert.equal(healthy.healthStatus, "healthy");
  assert.equal(healthy.alerts.length, 0);
  assert.deepEqual(healthy.thresholds, INGESTION_ALERT_THRESHOLDS);

  const degraded = evaluateSourceHealthAlerts(
    {
      enabled: true,
      approved: true,
      runState: "degraded",
      lastSuccessAt: new Date("2026-10-16T00:00:00.000Z"),
      quota: { requestsPerDay: 10, intervalMs: 3600_000 },
      quotaUsed: 9,
      circuit: { failures: 5, openUntil: new Date("2026-10-19T12:05:00.000Z") },
      metrics: { deadLettered: 12 },
    },
    { now },
  );
  assert.equal(degraded.healthStatus, "critical");
  const codes = degraded.alerts.map((alert) => alert.code);
  assert.ok(codes.includes("CIRCUIT_OPEN"));
  assert.ok(codes.includes("QUOTA_NEAR_EXHAUSTION"));
  assert.ok(codes.includes("DEAD_LETTER_SPIKE"));
  assert.ok(codes.includes("STALE_LAST_SUCCESS"));
});

test("BaseJobAdapter.requestJson retries transient 503/429 faults with backoff and succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("busy", { status: 503 });
    if (calls === 2) return new Response("rate limit", { status: 429 });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", etag: '"v1"' },
    });
  };
  try {
    const adapter = new BaseJobAdapter({
      key: "fault-test",
      maxRetries: 2,
      retryBackoffBaseMs: 1,
    });
    const res = await adapter.requestJson("https://example.com/jobs");
    assert.equal(calls, 3);
    assert.deepEqual(res.data, { ok: true });
    assert.equal(res.etag, '"v1"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("graceful shutdown flag toggles cleanly", () => {
  resetIngestionShutdown();
  assert.equal(isIngestionShuttingDown(), false);
  requestIngestionShutdown();
  assert.equal(isIngestionShuttingDown(), true);
  resetIngestionShutdown();
  assert.equal(isIngestionShuttingDown(), false);
});
