import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileJobIngestionSchedules,
  writeWorkerHeartbeat,
} from "../src/infrastructure/queue/repeatScheduleService.js";

test("repeat schedule reconciliation upserts enabled sources and removes disabled or stale schedules", async () => {
  const adds = [];
  const removed = [];
  const queue = {
    async getRepeatableJobs() {
      return [
        { name: "ingest:remotive", every: 30000, key: "old-remotive" },
        { name: "ingest:disabled", every: 30000, key: "disabled" },
        { name: "reminder", every: 30000, key: "unrelated" },
      ];
    },
    async removeRepeatableByKey(key) {
      removed.push(key);
    },
    async add(...args) {
      adds.push(args);
    },
  };
  const sources = [
    { key: "remotive", enabled: true, approved: true, quota: { intervalMs: 60000 } },
    { key: "disabled", enabled: false, approved: true, quota: { intervalMs: 60000 } },
    { key: "held", enabled: true, approved: false, quota: { intervalMs: 60000 } },
  ];
  assert.deepEqual(await reconcileJobIngestionSchedules(queue, sources), ["remotive"]);
  assert.deepEqual(removed, ["old-remotive", "disabled"]);
  assert.equal(adds.length, 1);
  assert.equal(adds[0][0], "ingest:remotive");
  assert.deepEqual(adds[0][2].repeat, { every: 60000 });
});

test("worker heartbeat uses a short TTL and preserves last-seen timestamp", async () => {
  const writes = [];
  const redis = {
    async set(...args) {
      writes.push(args);
    },
  };
  const now = new Date("2026-10-16T10:00:00Z");
  await writeWorkerHeartbeat(redis, now, "test-worker");
  assert.deepEqual(writes[0], [
    "jobscout:worker:heartbeat",
    JSON.stringify({ workerId: "test-worker", lastSeenAt: now.toISOString() }),
    "EX",
    45,
  ]);
  assert.equal(writes[1][0], "jobscout:worker:last-seen");
  assert.equal(writes[1][1], now.toISOString());
});
