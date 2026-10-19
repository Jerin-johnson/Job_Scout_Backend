import {
  ApplicationEntity,
  IApplicationContact,
  IApplicationActivity,
} from "../../../../domain/entities/Application.js";

export class ApplicationMapper {
  static toEntity(doc: unknown): ApplicationEntity | null {
    if (!doc || typeof doc !== "object") return null;
    const raw = doc as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : raw._id ? String(raw._id) : "";
    const userId = raw.userId ? String(raw.userId) : "";

    const rawContacts = Array.isArray(raw.contacts) ? raw.contacts : [];
    const contacts: IApplicationContact[] = rawContacts.map((c) => {
      const item = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      return {
        name: typeof item.name === "string" ? item.name : "",
        role: typeof item.role === "string" ? item.role : undefined,
        email: typeof item.email === "string" ? item.email : undefined,
        phone: typeof item.phone === "string" ? item.phone : undefined,
        notes: typeof item.notes === "string" ? item.notes : undefined,
      };
    });

    const rawActivity = Array.isArray(raw.activityLog)
      ? raw.activityLog
      : Array.isArray(raw.timeline)
      ? raw.timeline
      : [];

    const activityLog: IApplicationActivity[] = rawActivity.map((a) => {
      const item = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      return {
        action: typeof item.action === "string" ? item.action : typeof item.status === "string" ? item.status : "status_update",
        notes: typeof item.notes === "string" ? item.notes : typeof item.note === "string" ? item.note : undefined,
        date: item.date instanceof Date ? item.date : item.changedAt instanceof Date ? item.changedAt : new Date(String(item.date || item.changedAt || Date.now())),
      };
    });

    return {
      id,
      userId,
      jobId: typeof raw.jobId === "string" ? raw.jobId : null,
      companyName: typeof raw.company === "string" ? raw.company : typeof raw.companyName === "string" ? raw.companyName : "",
      jobTitle: typeof raw.role === "string" ? raw.role : typeof raw.jobTitle === "string" ? raw.jobTitle : "",
      status: typeof raw.status === "string" ? raw.status : "saved",
      priority: typeof raw.priority === "string" ? raw.priority : "medium",
      appliedDate: raw.appliedDate instanceof Date ? raw.appliedDate : new Date(String(raw.appliedDate || raw.createdAt || Date.now())),
      location: typeof raw.location === "string" ? raw.location : "",
      source: typeof raw.source === "string" ? raw.source : "",
      salaryMin: typeof raw.salaryMin === "number" ? raw.salaryMin : null,
      salaryMax: typeof raw.salaryMax === "number" ? raw.salaryMax : null,
      notes: typeof raw.notes === "string" ? raw.notes : "",
      contacts,
      activityLog,
      pinnedAt: raw.pinnedAt instanceof Date ? raw.pinnedAt : raw.pinnedAt ? new Date(String(raw.pinnedAt)) : null,
      archivedAt: raw.archivedAt instanceof Date ? raw.archivedAt : raw.archivedAt ? new Date(String(raw.archivedAt)) : null,
      archiveReason: typeof raw.archiveReason === "string" ? raw.archiveReason : "",
      nextFollowUpAt: raw.nextFollowUpAt instanceof Date ? raw.nextFollowUpAt : raw.nextFollowUpAt ? new Date(String(raw.nextFollowUpAt)) : null,
      lastActivityAt: raw.lastActivityAt instanceof Date ? raw.lastActivityAt : raw.lastActivityAt ? new Date(String(raw.lastActivityAt)) : null,
      createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(String(raw.createdAt || Date.now())),
      updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : new Date(String(raw.updatedAt || Date.now())),
    };
  }

  static toPersistence(entity: Partial<ApplicationEntity>): Record<string, unknown> {
    const data: Record<string, unknown> = { ...entity };
    if (data.id) {
      data._id = data.id;
      delete data.id;
    }
    if (data.companyName) {
      data.company = data.companyName;
    }
    if (data.jobTitle) {
      data.role = data.jobTitle;
    }
    return data;
  }
}
