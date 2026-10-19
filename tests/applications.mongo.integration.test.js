import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Application } from "../src/infrastructure/database/mongoose/models/ApplicationModel.js";
import { applicationController } from "../src/presentation/http/controllers/ApplicationController.js";
import { applicationRepository } from "../src/infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js";
import { setApplicationReminderQueueFactoryForTests } from "../src/services/applicationReminderQueue.js";

let mongo;
let mongoDataPath;
const jobs = new Map();
const removedJobs = [];
const reminderQueue = {
  async add(name, data, options) {
    jobs.set(options.jobId, {
      name,
      data,
      options,
      remove: async () => jobs.delete(options.jobId),
    });
    return jobs.get(options.jobId);
  },
  async getJob(id) {
    const job = jobs.get(id);
    if (!job) return null;
    return {
      ...job,
      remove: async () => {
        removedJobs.push(id);
        jobs.delete(id);
      },
    };
  },
};

before(async () => {
  mongoDataPath = mkdtempSync(join(process.cwd(), ".mongo-applications-test-"));
  mongo = await MongoMemoryServer.create({
    instance: { storageEngine: "wiredTiger", dbPath: mongoDataPath },
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.0.8" }
      : undefined,
  });
  await mongoose.connect(mongo.getUri(), { dbName: "applications-integration" });
  await Application.syncIndexes();
  setApplicationReminderQueueFactoryForTests(() => reminderQueue);
});

after(async () => {
  setApplicationReminderQueueFactoryForTests(null);
  await mongoose.disconnect();
  await mongo?.stop();
  if (mongoDataPath) rmSync(mongoDataPath, { recursive: true, force: true });
});

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function call(handler, { app, owner, body } = {}) {
  const res = response();
  await handler(
    { user: { id: String(owner) }, params: { id: String(app._id) }, body, id: "mongo-test" },
    res,
    (error) => {
      throw error;
    },
  );
  return res;
}

async function createApplication(overrides = {}) {
  return applicationRepository.create({
    userId: new mongoose.Types.ObjectId(),
    jobId: `mongo-${new mongoose.Types.ObjectId()}`,
    company: "Integration Example",
    role: "Application Engineer",
    ...overrides,
  });
}

test("Mongo ownership returns 404 for every application operation, including pin and priority", async () => {
  const owner = new mongoose.Types.ObjectId();
  const stranger = new mongoose.Types.ObjectId();
  const app = await createApplication({ userId: owner });
  const attempts = [
    [applicationController.getApplicationById],
    [applicationController.updateApplication, { pinnedAt: null }],
    [applicationController.updateApplication, { pinnedAt: new Date().toISOString() }],
    [applicationController.updateApplication, { priority: "high" }],
    [applicationController.updateStatus, { status: "applied" }],
    [applicationController.archiveApplication, { archived: true }],
    [applicationController.deleteApplication],
  ];
  for (const [handler, body] of attempts) {
    const result = await call(handler, { app, owner: stranger, body });
    assert.equal(result.statusCode, 404, handler.name);
    assert.equal(result.body.error.code, "NOT_FOUND", handler.name);
  }
  assert.ok(await Application.findById(app._id), "foreign delete must not delete the record");
});

test("pin, unpin, priority and archive persist in Mongo, and legacy documents get safe defaults", async () => {
  const owner = new mongoose.Types.ObjectId();
  const app = await createApplication({ userId: owner });
  const pinned = await call(applicationController.updateApplication, {
    app,
    owner,
    body: { pinnedAt: new Date().toISOString(), priority: "high" },
  });
  assert.equal(pinned.statusCode, 200);
  assert.ok(pinned.body.data.application.pinnedAt);
  assert.equal(pinned.body.data.application.priority, "high");
  const unpinned = await call(applicationController.updateApplication, {
    app,
    owner,
    body: { pinnedAt: null },
  });
  assert.equal(unpinned.statusCode, 200);
  assert.equal(unpinned.body.data.application.pinnedAt, null);
  assert.equal((await Application.findById(app._id).lean()).pinnedAt, null);

  const legacy = new mongoose.Types.ObjectId();
  await Application.collection.insertOne({
    _id: legacy,
    userId: owner,
    jobId: "legacy-no-new-fields",
    company: "Old Co",
    role: "Legacy role",
    status: "saved",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const hydratedLegacy = await applicationRepository.findOwnedById(legacy, owner);
  assert.equal(hydratedLegacy.priority, "medium");
  assert.equal(hydratedLegacy.pinnedAt, null);
  assert.equal(hydratedLegacy.archivedAt, null);
  assert.equal(hydratedLegacy.archiveReason, "");
  assert.equal(hydratedLegacy.source, "");
});

test("Mongo board query uses the user/archive/stage compound index", async () => {
  const owner = new mongoose.Types.ObjectId();
  const app = await createApplication({ userId: owner, status: "applied" });
  const plan = await Application.find({ userId: owner, archivedAt: null, status: "applied" })
    .hint("application_board_by_stage")
    .explain("executionStats");
  const winningPlan = JSON.stringify(plan.queryPlanner.winningPlan);
  assert.match(winningPlan, /application_board_by_stage/);
  assert.equal(plan.executionStats.nReturned, 1);
  assert.equal(String(app.userId), String(owner));
});

test("Mongo board filters search role/company and return unfiltered statistics", async () => {
  const owner = new mongoose.Types.ObjectId();
  await createApplication({
    userId: owner,
    company: "Northstar",
    role: "Platform Engineer",
    status: "applied",
    priority: "high",
  });
  await createApplication({
    userId: owner,
    company: "Contoso",
    role: "Designer",
    status: "interviewing",
    priority: "low",
  });
  const found = await applicationRepository.findByUserId(owner, {
    search: "platform",
    stages: ["applied"],
    priority: "high",
    sort: "recommended",
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].company, "Northstar");
  const stats = await applicationRepository.getBoardStats(owner);
  assert.equal(stats.totalActive, 2);
  assert.equal(stats.appliedThisWeek, 1);
  assert.equal(stats.interviews, 1);
  assert.equal(stats.responseRate, 50);
});

test("Mongo reminder queue is rescheduled on date changes and cancelled on terminal stage, archive, and delete", async () => {
  const owner = new mongoose.Types.ObjectId();
  const first = new Date(Date.now() + 3 * 86400000);
  const second = new Date(Date.now() + 5 * 86400000);

  const rescheduled = await createApplication({
    userId: owner,
    status: "applied",
    reminderEnabled: true,
    reminderStatus: "scheduled",
    nextFollowUpAt: first,
  });
  const oldJobId = `follow-up-${rescheduled._id}-${first.getTime()}`;
  const newJobId = `follow-up-${rescheduled._id}-${second.getTime()}`;
  await reminderQueue.add("follow-up", {}, { jobId: oldJobId });
  const changed = await call(applicationController.updateApplication, {
    app: rescheduled,
    owner,
    body: { nextFollowUpAt: second.toISOString(), reminderEnabled: true },
  });
  assert.equal(changed.statusCode, 200);
  assert.ok(removedJobs.includes(oldJobId));
  assert.ok(jobs.has(newJobId));
  assert.equal(
    (await Application.findById(rescheduled._id).lean()).nextFollowUpAt.getTime(),
    second.getTime(),
  );

  for (const status of ["offer", "rejected"]) {
    const app = await createApplication({
      userId: owner,
      status: "interviewing",
      reminderEnabled: true,
      reminderStatus: "scheduled",
      nextFollowUpAt: first,
    });
    const jobId = `follow-up-${app._id}-${first.getTime()}`;
    await reminderQueue.add("follow-up", {}, { jobId });
    const moved = await call(applicationController.updateStatus, { app, owner, body: { status } });
    assert.equal(moved.statusCode, 200);
    assert.ok(removedJobs.includes(jobId), `${status} should cancel reminder`);
    assert.equal((await Application.findById(app._id).lean()).reminderEnabled, false);
  }

  const archived = await createApplication({
    userId: owner,
    reminderEnabled: true,
    reminderStatus: "scheduled",
    nextFollowUpAt: first,
  });
  const archiveJob = `follow-up-${archived._id}-${first.getTime()}`;
  await reminderQueue.add("follow-up", {}, { jobId: archiveJob });
  const archiveResponse = await call(applicationController.archiveApplication, {
    app: archived,
    owner,
    body: { archived: true, reason: "ghosted" },
  });
  assert.equal(archiveResponse.statusCode, 200);
  assert.ok(removedJobs.includes(archiveJob));
  assert.ok((await Application.findById(archived._id).lean()).archivedAt);

  const deleted = await createApplication({
    userId: owner,
    reminderEnabled: true,
    reminderStatus: "scheduled",
    nextFollowUpAt: first,
  });
  const deleteJob = `follow-up-${deleted._id}-${first.getTime()}`;
  await reminderQueue.add("follow-up", {}, { jobId: deleteJob });
  const deleteResponse = await call(applicationController.deleteApplication, {
    app: deleted,
    owner,
  });
  assert.equal(deleteResponse.statusCode, 200);
  assert.ok(removedJobs.includes(deleteJob));
  assert.equal(await Application.findById(deleted._id), null);
});
