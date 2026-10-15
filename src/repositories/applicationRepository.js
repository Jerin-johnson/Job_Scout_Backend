import { Application } from "../models/Application.js";
import { isMongoReady } from "../config/database.js";

const inMemoryApplications = new Map();
let appCounter = 1;

function withApplicationDefaults(application) {
  if (!application) return application;
  return {
    ...application,
    priority: application.priority || "medium",
    pinnedAt: application.pinnedAt ?? null,
    archivedAt: application.archivedAt ?? null,
    archiveReason: application.archiveReason || "",
    source: application.source || "",
    location: application.location || "",
    salaryMin: application.salaryMin ?? null,
    salaryMax: application.salaryMax ?? null,
  };
}

export const applicationRepository = {
  async findById(id) {
    if (isMongoReady()) {
      return Application.findById(id).lean();
    }
    return inMemoryApplications.get(id) || null;
  },

  async findOwnedById(id, userId) {
    if (isMongoReady())
      return withApplicationDefaults(await Application.findOne({ _id: id, userId }).lean());
    const app = inMemoryApplications.get(id);
    return app && app.userId.toString() === userId.toString() ? app : null;
  },

  async findByUserId(userId, filters = {}) {
    const uid = userId.toString();
    const query = { userId, archivedAt: null };
    if (filters.stages?.length) query.status = { $in: filters.stages };
    if (filters.priority) query.priority = filters.priority;
    if (filters.pinned === true) query.pinnedAt = { $ne: null };
    if (filters.pinned === false) query.pinnedAt = null;
    const now = new Date();
    if (filters.followUp === "overdue") query.nextFollowUpAt = { $lt: now };
    if (filters.followUp === "due-soon")
      query.nextFollowUpAt = { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) };
    if (filters.stale) {
      query.$and = [
        ...(query.$and || []),
        { status: "applied" },
        {
          $or: [
            { lastActivityAt: { $lte: new Date(now.getTime() - filters.staleDays * 86400000) } },
            {
              lastActivityAt: null,
              updatedAt: { $lte: new Date(now.getTime() - filters.staleDays * 86400000) },
            },
          ],
        },
      ];
    }
    if (filters.appliedSinceDays) {
      query.$and = [
        ...(query.$and || []),
        { status: "applied" },
        {
          timeline: {
            $elemMatch: {
              status: "applied",
              changedAt: { $gte: new Date(now.getTime() - filters.appliedSinceDays * 86400000) },
            },
          },
        },
      ];
    }
    if (filters.search) {
      const escaped = filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { company: { $regex: escaped, $options: "i" } },
            { role: { $regex: escaped, $options: "i" } },
          ],
        },
      ];
    }
    if (isMongoReady()) {
      const applications = (await Application.find(query).lean()).map(withApplicationDefaults);
      return sortApplications(applications, filters.sort);
    }
    let applications = [...inMemoryApplications.values()]
      .filter((a) => a.userId.toString() === uid)
      .filter((a) => !a.archivedAt);
    if (filters.search) {
      const value = filters.search.toLocaleLowerCase();
      applications = applications.filter((app) =>
        `${app.company} ${app.role}`.toLocaleLowerCase().includes(value),
      );
    }
    if (filters.stages?.length)
      applications = applications.filter((app) => filters.stages.includes(app.status));
    if (filters.priority)
      applications = applications.filter((app) => app.priority === filters.priority);
    if (filters.pinned !== undefined)
      applications = applications.filter((app) => Boolean(app.pinnedAt) === filters.pinned);
    if (filters.followUp === "overdue")
      applications = applications.filter(
        (app) => app.nextFollowUpAt && new Date(app.nextFollowUpAt) < now,
      );
    if (filters.followUp === "due-soon")
      applications = applications.filter(
        (app) =>
          app.nextFollowUpAt &&
          new Date(app.nextFollowUpAt) >= now &&
          new Date(app.nextFollowUpAt) <= new Date(now.getTime() + 7 * 86400000),
      );
    if (filters.appliedSinceDays) {
      const since = new Date(now.getTime() - filters.appliedSinceDays * 86400000);
      applications = applications.filter(
        (app) =>
          app.status === "applied" &&
          (app.timeline || []).some(
            (item) => item.status === "applied" && new Date(item.changedAt) >= since,
          ),
      );
    }
    if (filters.stale)
      applications = applications.filter(
        (app) =>
          app.status === "applied" &&
          new Date(app.lastActivityAt || app.updatedAt) <=
            new Date(now.getTime() - filters.staleDays * 86400000),
      );
    return sortApplications(applications, filters.sort);
  },

  async getBoardStats(userId) {
    const applications = isMongoReady()
      ? await Application.find({ userId, archivedAt: null }).lean()
      : [...inMemoryApplications.values()].filter(
          (app) => app.userId.toString() === userId.toString() && !app.archivedAt,
        );
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const applied = applications.filter((app) => app.status === "applied");
    const responses = applications.filter((app) =>
      ["screening", "interviewing", "offer", "rejected"].includes(app.status),
    ).length;
    const total = applications.length;
    return {
      totalActive: total,
      appliedThisWeek: applied.filter((app) =>
        (app.timeline || []).some(
          (item) => item.status === "applied" && new Date(item.changedAt) >= weekStart,
        ),
      ).length,
      interviews: applications.filter((app) => app.status === "interviewing").length,
      offers: applications.filter((app) => app.status === "offer").length,
      responseRate: total ? Math.round((responses / total) * 100) : 0,
      followUpsDue: applications.filter(
        (app) => app.nextFollowUpAt && new Date(app.nextFollowUpAt) <= now,
      ).length,
    };
  },

  async create(data) {
    const uid = data.userId.toString();
    if (isMongoReady()) {
      const app = new Application({
        ...data,
        lastActivityAt: data.lastActivityAt || new Date(),
        timeline: [
          { status: data.status || "saved", changedAt: new Date(), note: "Application created" },
        ],
      });
      return (await app.save()).toObject();
    }

    const id = `app_${appCounter++}_${Date.now()}`;
    const newApp = {
      _id: id,
      ...data,
      userId: uid,
      status: data.status || "saved",
      priority: data.priority || "medium",
      pinnedAt: data.pinnedAt || null,
      archivedAt: data.archivedAt || null,
      archiveReason: data.archiveReason || "",
      source: data.source || "",
      lastActivityAt: data.lastActivityAt || new Date(),
      timeline: [
        {
          status: data.status || "saved",
          changedAt: new Date(),
          note: "Application created",
        },
      ],
      notes: data.notes || "",
      nextFollowUpAt: data.nextFollowUpAt || null,
      followUpDraft: data.followUpDraft || {
        subject: "",
        body: "",
        status: "none",
        sentAt: null,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    inMemoryApplications.set(id, newApp);
    return newApp;
  },

  async update(id, updates, { activity = false } = {}) {
    const changes = activity ? { ...updates, lastActivityAt: new Date() } : updates;
    if (isMongoReady()) {
      return withApplicationDefaults(
        await Application.findByIdAndUpdate(id, { $set: changes }, { new: true }).lean(),
      );
    }
    const existing = inMemoryApplications.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...changes,
      updatedAt: new Date(),
    };
    inMemoryApplications.set(id, updated);
    return updated;
  },

  async claimDueReminder(id, dueAt, claimId) {
    const now = new Date();
    if (new Date(dueAt) > now) return null;
    if (isMongoReady()) {
      return Application.findOneAndUpdate(
        {
          _id: id,
          reminderEnabled: true,
          nextFollowUpAt: dueAt,
          $or: [
            { reminderStatus: "scheduled" },
            { reminderStatus: "processing", reminderClaimId: claimId },
          ],
        },
        { $set: { reminderStatus: "processing", reminderClaimId: claimId } },
        { new: true },
      ).lean();
    }
    const app = inMemoryApplications.get(id);
    if (
      !app ||
      !app.reminderEnabled ||
      !["scheduled", "processing"].includes(app.reminderStatus) ||
      (app.reminderStatus === "processing" && app.reminderClaimId !== claimId) ||
      new Date(app.nextFollowUpAt).getTime() !== new Date(dueAt).getTime() ||
      new Date(dueAt) > now
    )
      return null;
    const claimed = {
      ...app,
      reminderStatus: "processing",
      reminderClaimId: claimId,
      updatedAt: now,
    };
    inMemoryApplications.set(id, claimed);
    return claimed;
  },

  async addTimelineEntry(id, status, note = "") {
    const activityAt = new Date();
    const entry = { status, changedAt: activityAt, note };
    if (isMongoReady()) {
      return Application.findByIdAndUpdate(
        id,
        {
          $set: { status, lastActivityAt: activityAt },
          $push: { timeline: entry },
        },
        { new: true },
      ).lean();
    }
    const existing = inMemoryApplications.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      status,
      lastActivityAt: activityAt,
      timeline: [...(existing.timeline || []), entry],
      updatedAt: new Date(),
    };
    inMemoryApplications.set(id, updated);
    return updated;
  },

  async delete(id) {
    if (isMongoReady()) {
      return Application.findByIdAndDelete(id).lean();
    }
    const existing = inMemoryApplications.get(id);
    if (existing) {
      inMemoryApplications.delete(id);
      return existing;
    }
    return null;
  },
};

function sortApplications(applications, sort = "recommended") {
  const weights = { high: 3, medium: 2, low: 1 };
  const activity = (app) =>
    new Date(app.lastActivityAt || app.updatedAt || app.createdAt || 0).getTime();
  return applications.sort((a, b) => {
    if (sort === "recent") return activity(b) - activity(a);
    if (sort === "follow-up")
      return new Date(a.nextFollowUpAt || Infinity) - new Date(b.nextFollowUpAt || Infinity);
    if (sort === "priority")
      return (weights[b.priority || "medium"] || 2) - (weights[a.priority || "medium"] || 2);
    const pin = Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt));
    if (pin) return pin;
    const priority =
      (weights[b.priority || "medium"] || 2) - (weights[a.priority || "medium"] || 2);
    if (priority) return priority;
    const dueA = a.nextFollowUpAt ? new Date(a.nextFollowUpAt).getTime() : Infinity;
    const dueB = b.nextFollowUpAt ? new Date(b.nextFollowUpAt).getTime() : Infinity;
    const due = dueA - dueB;
    return due || activity(b) - activity(a);
  });
}
