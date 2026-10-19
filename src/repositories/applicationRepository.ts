import mongoose from "mongoose";
import { Application } from "../models/Application.js";
import { isMongoReady } from "../config/database.js";

export interface TimelineEntry {
  status: string;
  changedAt: Date;
  note?: string;
  [key: string]: unknown;
}

export interface ApplicationRecord {
  _id: string | mongoose.Types.ObjectId;
  userId: string | mongoose.Types.ObjectId;
  company?: string;
  role?: string;
  status?: string;
  priority?: string;
  pinnedAt?: Date | null;
  archivedAt?: Date | null;
  archiveReason?: string;
  source?: string;
  location?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  notes?: string;
  lastActivityAt?: Date;
  nextFollowUpAt?: Date | null;
  followUpDraft?: {
    subject?: string;
    body?: string;
    status?: string;
    sentAt?: Date | null;
    [key: string]: unknown;
  };
  reminderEnabled?: boolean;
  reminderStatus?: string;
  reminderClaimId?: string;
  timeline?: TimelineEntry[];
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

export interface ApplicationFilters {
  stages?: string[];
  priority?: string;
  pinned?: boolean;
  followUp?: "overdue" | "due-soon" | string;
  stale?: boolean;
  staleDays?: number;
  appliedSinceDays?: number;
  search?: string;
  sort?: "recent" | "follow-up" | "priority" | "recommended" | string;
  [key: string]: unknown;
}

export interface BoardStats {
  totalActive: number;
  appliedThisWeek: number;
  interviews: number;
  offers: number;
  responseRate: number;
  followUpsDue: number;
}

const inMemoryApplications = new Map<string, ApplicationRecord>();
let appCounter = 1;

function withApplicationDefaults(application: ApplicationRecord | null): ApplicationRecord | null {
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

function sortApplications(applications: ApplicationRecord[], sort: string = "recommended"): ApplicationRecord[] {
  const weights: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const activity = (app: ApplicationRecord) =>
    new Date((app.lastActivityAt || app.updatedAt || app.createdAt || 0) as string | number | Date).getTime();
  return applications.sort((a, b) => {
    if (sort === "recent") return activity(b) - activity(a);
    if (sort === "follow-up")
      return new Date(a.nextFollowUpAt || Infinity).getTime() - new Date(b.nextFollowUpAt || Infinity).getTime();
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

export const applicationRepository = {
  async findById(id: string | mongoose.Types.ObjectId): Promise<ApplicationRecord | null> {
    if (isMongoReady()) {
      return (await Application.findById(id).lean()) as unknown as ApplicationRecord | null;
    }
    return inMemoryApplications.get(id.toString()) || null;
  },

  async findOwnedById(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId): Promise<ApplicationRecord | null> {
    if (isMongoReady()) {
      const doc = (await Application.findOne({ _id: id, userId }).lean()) as unknown as ApplicationRecord | null;
      return withApplicationDefaults(doc);
    }
    const app = inMemoryApplications.get(id.toString());
    return app && app.userId.toString() === userId.toString() ? app : null;
  },

  async findByUserId(userId: string | mongoose.Types.ObjectId, filters: ApplicationFilters = {}): Promise<ApplicationRecord[]> {
    const uid = userId.toString();
    const query: Record<string, unknown> = { userId, archivedAt: null };
    if (filters.stages?.length) query.status = { $in: filters.stages };
    if (filters.priority) query.priority = filters.priority;
    if (filters.pinned === true) query.pinnedAt = { $ne: null };
    if (filters.pinned === false) query.pinnedAt = null;
    const now = new Date();
    if (filters.followUp === "overdue") query.nextFollowUpAt = { $lt: now };
    if (filters.followUp === "due-soon")
      query.nextFollowUpAt = { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) };
    if (filters.stale) {
      const staleDays = filters.staleDays || 14;
      query.$and = [
        ...((query.$and as Record<string, unknown>[]) || []),
        { status: "applied" },
        {
          $or: [
            { lastActivityAt: { $lte: new Date(now.getTime() - staleDays * 86400000) } },
            {
              lastActivityAt: null,
              updatedAt: { $lte: new Date(now.getTime() - staleDays * 86400000) },
            },
          ],
        },
      ];
    }
    if (filters.appliedSinceDays) {
      query.$and = [
        ...((query.$and as Record<string, unknown>[]) || []),
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
        ...((query.$and as Record<string, unknown>[]) || []),
        {
          $or: [
            { company: { $regex: escaped, $options: "i" } },
            { role: { $regex: escaped, $options: "i" } },
          ],
        },
      ];
    }
    if (isMongoReady()) {
      const docs = (await Application.find(query).lean()) as unknown as ApplicationRecord[];
      const applications = docs.map((d) => withApplicationDefaults(d)!);
      return sortApplications(applications, filters.sort);
    }
    let applications = [...inMemoryApplications.values()]
      .filter((a) => a.userId.toString() === uid)
      .filter((a) => !a.archivedAt);
    if (filters.search) {
      const value = filters.search.toLocaleLowerCase();
      applications = applications.filter((app) =>
        `${app.company || ""} ${app.role || ""}`.toLocaleLowerCase().includes(value),
      );
    }
    if (filters.stages?.length)
      applications = applications.filter((app) => filters.stages!.includes(app.status || ""));
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
    if (filters.stale) {
      const staleDays = filters.staleDays || 14;
      applications = applications.filter(
        (app) =>
          app.status === "applied" &&
          new Date((app.lastActivityAt || app.updatedAt) as string | number | Date) <=
            new Date(now.getTime() - staleDays * 86400000),
      );
    }
    return sortApplications(applications, filters.sort);
  },

  async getBoardStats(userId: string | mongoose.Types.ObjectId): Promise<BoardStats> {
    const applications = isMongoReady()
      ? ((await Application.find({ userId, archivedAt: null }).lean()) as unknown as ApplicationRecord[])
      : [...inMemoryApplications.values()].filter(
          (app) => app.userId.toString() === userId.toString() && !app.archivedAt,
        );
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const applied = applications.filter((app) => app.status === "applied");
    const responses = applications.filter((app) =>
      ["screening", "interviewing", "offer", "rejected"].includes(app.status || ""),
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

  async create(data: Partial<ApplicationRecord> & { userId: string | mongoose.Types.ObjectId }): Promise<ApplicationRecord> {
    const uid = data.userId.toString();
    if (isMongoReady()) {
      const app = new Application({
        ...data,
        lastActivityAt: data.lastActivityAt || new Date(),
        timeline: [
          { status: data.status || "saved", changedAt: new Date(), note: "Application created" },
        ],
      });
      return (await app.save()).toObject() as unknown as ApplicationRecord;
    }

    const id = `app_${appCounter++}_${Date.now()}`;
    const newApp: ApplicationRecord = {
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

  async update(
    id: string | mongoose.Types.ObjectId,
    updates: Partial<ApplicationRecord>,
    { activity = false }: { activity?: boolean } = {},
  ): Promise<ApplicationRecord | null> {
    const changes = activity ? { ...updates, lastActivityAt: new Date() } : updates;
    const idStr = id.toString();
    if (isMongoReady()) {
      const doc = (await Application.findByIdAndUpdate(id, { $set: changes }, { new: true }).lean()) as unknown as ApplicationRecord | null;
      return withApplicationDefaults(doc);
    }
    const existing = inMemoryApplications.get(idStr);
    if (!existing) return null;
    const updated: ApplicationRecord = {
      ...existing,
      ...changes,
      updatedAt: new Date(),
    };
    inMemoryApplications.set(idStr, updated);
    return updated;
  },

  async claimDueReminder(
    id: string | mongoose.Types.ObjectId,
    dueAt: Date | string,
    claimId: string,
  ): Promise<ApplicationRecord | null> {
    const now = new Date();
    if (new Date(dueAt) > now) return null;
    const idStr = id.toString();
    if (isMongoReady()) {
      return (await Application.findOneAndUpdate(
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
      ).lean()) as unknown as ApplicationRecord | null;
    }
    const app = inMemoryApplications.get(idStr);
    if (
      !app ||
      !app.reminderEnabled ||
      !["scheduled", "processing"].includes(app.reminderStatus || "") ||
      (app.reminderStatus === "processing" && app.reminderClaimId !== claimId) ||
      new Date(app.nextFollowUpAt || 0).getTime() !== new Date(dueAt).getTime() ||
      new Date(dueAt) > now
    )
      return null;
    const claimed: ApplicationRecord = {
      ...app,
      reminderStatus: "processing",
      reminderClaimId: claimId,
      updatedAt: now,
    };
    inMemoryApplications.set(idStr, claimed);
    return claimed;
  },

  async addTimelineEntry(id: string | mongoose.Types.ObjectId, status: string, note: string = ""): Promise<ApplicationRecord | null> {
    const activityAt = new Date();
    const entry: TimelineEntry = { status, changedAt: activityAt, note };
    const idStr = id.toString();
    if (isMongoReady()) {
      return (await Application.findByIdAndUpdate(
        id,
        {
          $set: { status, lastActivityAt: activityAt },
          $push: { timeline: entry },
        },
        { new: true },
      ).lean()) as unknown as ApplicationRecord | null;
    }
    const existing = inMemoryApplications.get(idStr);
    if (!existing) return null;
    const updated: ApplicationRecord = {
      ...existing,
      status,
      lastActivityAt: activityAt,
      timeline: [...(existing.timeline || []), entry],
      updatedAt: new Date(),
    };
    inMemoryApplications.set(idStr, updated);
    return updated;
  },

  async delete(id: string | mongoose.Types.ObjectId): Promise<ApplicationRecord | null> {
    const idStr = id.toString();
    if (isMongoReady()) {
      return (await Application.findByIdAndDelete(id).lean()) as unknown as ApplicationRecord | null;
    }
    const existing = inMemoryApplications.get(idStr);
    if (existing) {
      inMemoryApplications.delete(idStr);
      return existing;
    }
    return null;
  },
};
