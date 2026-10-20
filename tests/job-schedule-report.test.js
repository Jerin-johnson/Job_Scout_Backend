import test from "node:test";
import assert from "node:assert/strict";
import { buildJobScheduleReport } from "../src/domain/services/jobs/scheduleReport.js";

test("job schedule report distinguishes registered, mismatched, and missing repeat jobs", () => {
  const sources = [
    {
      key: "remotive",
      enabled: true,
      approved: true,
      quota: { intervalMs: 60000 },
      lastRunAt: new Date(1000),
    },
    { key: "jobicy", enabled: true, approved: true, quota: { intervalMs: 120000 } },
    { key: "held", enabled: false, approved: false, quota: { intervalMs: 60000 } },
  ];
  const report = buildJobScheduleReport(
    sources,
    [
      { name: "ingest:remotive", every: 60000, next: 65000 },
      { name: "ingest:jobicy", every: 30000, next: 66000 },
    ],
    50000,
  );
  assert.deepEqual(report, [
    {
      source: "remotive",
      worker: { status: "offline", online: false, lastSeenAt: null },
      enabled: true,
      intervalMs: 60000,
      registrationStatus: "registered",
      nextScheduledRun: new Date(65000).toISOString(),
      nextEligibleFromLastRun: new Date(61000).toISOString(),
    },
    {
      source: "jobicy",
      worker: { status: "offline", online: false, lastSeenAt: null },
      enabled: true,
      intervalMs: 120000,
      registrationStatus: "interval_mismatch",
      nextScheduledRun: null,
      nextEligibleFromLastRun: null,
    },
    {
      source: "held",
      worker: { status: "offline", online: false, lastSeenAt: null },
      enabled: false,
      intervalMs: 60000,
      registrationStatus: "disabled",
      nextScheduledRun: null,
      nextEligibleFromLastRun: null,
    },
  ]);
});

test("job schedule report includes worker status and last seen", () => {
  const seenAt = new Date("2026-10-16T10:00:00Z");
  const [source] = buildJobScheduleReport(
    [{ key: "remotive", enabled: true, approved: true, quota: { intervalMs: 60000 } }],
    [{ name: "ingest:remotive", every: 60000, next: 70000 }],
    50000,
    { online: true, lastSeenAt: seenAt },
  );
  assert.deepEqual(source.worker, { status: "online", online: true, lastSeenAt: seenAt });
});

test("missing repeat registration is reported rather than predicted", () => {
  const [source] = buildJobScheduleReport(
    [{ key: "remotive", enabled: true, approved: true, quota: { intervalMs: 60000 } }],
    [],
  );
  assert.equal(source.registrationStatus, "not_registered");
  assert.equal(source.nextScheduledRun, null);
});
