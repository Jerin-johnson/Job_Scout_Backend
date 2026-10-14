import { Application } from "../models/Application.js";
import { isMongoReady } from "../config/database.js";

const inMemoryApplications = new Map();
let appCounter = 1;

export const applicationRepository = {
  async findById(id) {
    if (isMongoReady()) {
      return Application.findById(id).lean();
    }
    return inMemoryApplications.get(id) || null;
  },

  async findByUserId(userId) {
    const uid = userId.toString();
    if (isMongoReady()) {
      return Application.find({ userId }).sort({ updatedAt: -1 }).lean();
    }
    return [...inMemoryApplications.values()]
      .filter((a) => a.userId.toString() === uid)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  },

  async create(data) {
    const uid = data.userId.toString();
    if (isMongoReady()) {
      const app = new Application({
        ...data,
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

  async update(id, updates) {
    if (isMongoReady()) {
      return Application.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean();
    }
    const existing = inMemoryApplications.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    inMemoryApplications.set(id, updated);
    return updated;
  },

  async addTimelineEntry(id, status, note = "") {
    const entry = { status, changedAt: new Date(), note };
    if (isMongoReady()) {
      return Application.findByIdAndUpdate(
        id,
        {
          $set: { status },
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
