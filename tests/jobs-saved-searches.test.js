import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  getSavedSearchPlanLimits,
  isWithinQuietHours,
  selectUnsentAlertJobs,
  appendBoundedSentJobIds,
  canSendSavedSearchAlert,
  savedSearchService,
} from "../src/services/jobs/savedSearchService.js";
import { SavedSearch } from "../src/models/SavedSearch.js";
import { User } from "../src/models/User.js";

test("getSavedSearchPlanLimits enforces Free (3), Pro (15), and Premium (50) tier caps", () => {
  assert.deepEqual(getSavedSearchPlanLimits("free"), {
    tier: "free",
    savedSearchesMax: 3,
    dailyAlertsMax: 2,
  });
  assert.deepEqual(getSavedSearchPlanLimits("pro"), {
    tier: "pro",
    savedSearchesMax: 15,
    dailyAlertsMax: 10,
  });
  assert.deepEqual(getSavedSearchPlanLimits("premium"), {
    tier: "premium",
    savedSearchesMax: 50,
    dailyAlertsMax: 25,
  });
});

test("isWithinQuietHours handles both overnight and daytime UTC ranges", () => {
  const overnight = { enabled: true, startHourUtc: 22, endHourUtc: 7 };
  assert.equal(isWithinQuietHours(overnight, new Date("2026-10-19T23:30:00Z")), true);
  assert.equal(isWithinQuietHours(overnight, new Date("2026-10-19T03:00:00Z")), true);
  assert.equal(isWithinQuietHours(overnight, new Date("2026-10-19T12:00:00Z")), false);

  const daytime = { enabled: true, startHourUtc: 9, endHourUtc: 17 };
  assert.equal(isWithinQuietHours(daytime, new Date("2026-10-19T10:00:00Z")), true);
  assert.equal(isWithinQuietHours(daytime, new Date("2026-10-19T18:00:00Z")), false);
  assert.equal(
    isWithinQuietHours(
      { enabled: false, startHourUtc: 22, endHourUtc: 7 },
      new Date("2026-10-19T23:30:00Z"),
    ),
    false,
  );
});

test("selectUnsentAlertJobs and appendBoundedSentJobIds deduplicate and cap tracked job IDs", () => {
  const candidates = [
    { jobId: "job_1", title: "Nurse", status: "active" },
    { jobId: "job_2", title: "ICU Nurse", status: "active" },
    { jobId: "job_3", title: "Closed Role", status: "closed" },
    { jobId: "job_4", title: "Ward Nurse", status: "active" },
  ];
  const unsent = selectUnsentAlertJobs(candidates, ["job_1"], { maxJobs: 2 });
  assert.deepEqual(
    unsent.map((job) => job.jobId),
    ["job_2", "job_4"],
  );

  const bounded = appendBoundedSentJobIds(["a", "b", "c"], ["c", "d", "e"], 4);
  assert.deepEqual(bounded, ["b", "c", "d", "e"]);
});

test("canSendSavedSearchAlert enforces quiet hours, cooldowns, and daily plan rate limits", () => {
  const now = new Date("2026-10-19T14:00:00Z");
  const baseSearch = {
    enabled: true,
    alertFrequency: "daily",
    quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 7 },
    lastAlertedAt: new Date("2026-10-18T10:00:00Z"),
    alertWindowDay: "2026-10-19",
    alertsSentToday: 0,
  };
  assert.equal(canSendSavedSearchAlert(baseSearch, { plan: "free", now }).allowed, true);
  assert.equal(
    canSendSavedSearchAlert({ ...baseSearch, alertsSentToday: 2 }, { plan: "free", now }).reason,
    "daily_rate_limit",
  );
  assert.equal(
    canSendSavedSearchAlert(
      { ...baseSearch, lastAlertedAt: new Date("2026-10-19T08:00:00Z") },
      { plan: "free", now },
    ).reason,
    "daily_cooldown",
  );
  assert.equal(
    canSendSavedSearchAlert(baseSearch, {
      plan: "free",
      now: new Date("2026-10-19T23:15:00Z"),
    }).reason,
    "quiet_hours",
  );
});

test("savedSearchService CRUD, tier limits, one-click unsubscribe, and GDPR export/deletion work in MongoDB", async (t) => {
  const mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.0.8" }
      : undefined,
  });
  await mongoose.connect(mongo.getUri("jobscout_saved_search_test"));
  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  await SavedSearch.syncIndexes();
  const userId = new mongoose.Types.ObjectId();
  const freeUser = { _id: userId, plan: "free", email: "user@example.com", name: "Test User" };
  await User.create({
    _id: userId,
    email: "user@example.com",
    passwordHash: "hash",
    name: "Test User",
    plan: "free",
  });

  const first = await savedSearchService.create(freeUser, {
    name: "Kerala ICU Nursing",
    filters: { q: "icu nurse", countryCode: "in", occupation: "nursing", remoteType: "onsite" },
    alertFrequency: "daily",
    quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 6 },
  });
  assert.equal(first.name, "Kerala ICU Nursing");
  assert.equal(first.filters.countryCode, "IN");
  assert.ok(first.unsubscribeToken);

  await savedSearchService.create(freeUser, { filters: { q: "react developer" } });
  await savedSearchService.create(freeUser, { filters: { q: "node engineer" } });

  await assert.rejects(savedSearchService.create(freeUser, { filters: { q: "fourth search" } }), {
    code: "SAVED_SEARCH_LIMIT_REACHED",
  });

  const updated = await savedSearchService.update(userId, first.id, {
    name: "Kerala & Gulf Nursing",
    alertFrequency: "instant",
  });
  assert.equal(updated.name, "Kerala & Gulf Nursing");
  assert.equal(updated.alertFrequency, "instant");

  const unsubscribed = await savedSearchService.unsubscribe(first.id, {
    token: first.unsubscribeToken,
  });
  assert.equal(unsubscribed.enabled, false);
  assert.equal(unsubscribed.alertFrequency, "none");

  const exported = await savedSearchService.exportForUser(userId);
  assert.equal(exported.length, 3);
  assert.equal(exported[0].unsubscribeToken, undefined);

  const deletedCount = await savedSearchService.deleteAllForUser(userId);
  assert.equal(deletedCount, 3);
  const afterDelete = await savedSearchService.listByUser(userId, { plan: "free" });
  assert.equal(afterDelete.savedSearches.length, 0);
});
