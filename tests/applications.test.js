import test from "node:test";
import assert from "node:assert/strict";
import { applicationController } from "../src/presentation/http/controllers/ApplicationController.js";
import { applicationRepository } from "../src/infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js";
import { Application } from "../src/infrastructure/database/mongoose/models/ApplicationModel.js";
import { applicationReminderTransition } from "../src/domain/services/applications/applicationLifecycle.js";

test("application model adds safe defaults for priority, pinning, archive, and source", () => {
  for (const field of [
    "priority",
    "pinnedAt",
    "archivedAt",
    "archiveReason",
    "source",
    "lastActivityAt",
  ])
    assert.ok(Application.schema.path(field), `${field} should be persisted`);
  const application = new Application({
    userId: "507f1f77bcf86cd799439011",
    jobId: "legacy",
    company: "Example",
    role: "Engineer",
  });
  assert.equal(application.priority, "medium");
  assert.equal(application.pinnedAt, null);
  assert.equal(application.archivedAt, null);
});

test("all id-based application endpoints hide another user's records with 404", async () => {
  const app = await applicationRepository.create({
    userId: "owner-test-a",
    jobId: `ownership-${Date.now()}`,
    company: "Example",
    role: "Engineer",
  });
  try {
    assert.equal(
      await applicationRepository.findOwnedById(app._id, "owner-test-a").then(Boolean),
      true,
    );
    assert.equal(await applicationRepository.findOwnedById(app._id, "owner-test-b"), null);
    const endpoints = [
      [applicationController.getApplicationById, undefined],
      [applicationController.updateApplication, { priority: "high" }],
      [applicationController.updateStatus, { status: "applied" }],
      [applicationController.approveFollowUp, undefined],
      [applicationController.archiveApplication, { archived: true }],
      [applicationController.deleteApplication, undefined],
    ];
    for (const [handler, body] of endpoints) {
      const result = {
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
      await handler(
        { user: { id: "owner-test-b" }, params: { id: app._id }, body, id: "request" },
        result,
        (error) => {
          throw error;
        },
      );
      assert.equal(result.statusCode, 404, handler.name);
      assert.equal(result.body.error.code, "NOT_FOUND", handler.name);
    }
  } finally {
    await applicationRepository.delete(app._id);
  }
});

test("changing a follow-up date cancels the old reminder and reschedules when enabled", () => {
  const app = {
    status: "applied",
    reminderEnabled: true,
    nextFollowUpAt: "2026-11-01T10:00:00.000Z",
  };
  assert.deepEqual(
    applicationReminderTransition({
      application: app,
      nextFollowUpAt: "2026-11-02T10:00:00.000Z",
      reminderEnabled: true,
    }),
    { cancel: true, enabled: true, schedule: true, terminal: false },
  );
  assert.deepEqual(
    applicationReminderTransition({
      application: app,
      nextFollowUpAt: app.nextFollowUpAt,
      reminderEnabled: true,
    }),
    { cancel: false, enabled: true, schedule: false, terminal: false },
  );
});

test("offer, rejection, and archive cancel reminders without scheduling another", () => {
  const app = {
    status: "interviewing",
    reminderEnabled: true,
    nextFollowUpAt: "2026-11-01T10:00:00.000Z",
  };
  for (const status of ["offer", "rejected"])
    assert.deepEqual(applicationReminderTransition({ application: app, status }), {
      cancel: true,
      enabled: false,
      schedule: false,
      terminal: true,
    });
  assert.deepEqual(applicationReminderTransition({ application: app, archived: true }), {
    cancel: true,
    enabled: false,
    schedule: false,
    terminal: false,
  });
});
