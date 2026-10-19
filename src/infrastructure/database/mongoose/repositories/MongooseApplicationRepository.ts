import { injectable } from "tsyringe";
import { BaseMongooseRepository } from "./BaseMongooseRepository.js";
import { ApplicationModel, IApplicationDocument } from "../models/ApplicationModel.js";
import { ApplicationEntity } from "../../../../domain/entities/Application.js";
import {
  IApplicationRepository,
  IApplicationFilterOptions,
} from "../../../../domain/repositories/IApplicationRepository.js";
import { ApplicationMapper } from "../mappers/ApplicationMapper.js";
import { isMongoReady } from "../../../../config/database.js";

function withApplicationDefaults(application: Record<string, unknown>): Record<string, unknown> {
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

@injectable()
export class MongooseApplicationRepository
  extends BaseMongooseRepository<IApplicationDocument, ApplicationEntity, string>
  implements IApplicationRepository
{
  private appCounter = 1;

  constructor() {
    super(ApplicationModel);
  }

  protected toEntity(doc: unknown): ApplicationEntity {
    const entity = ApplicationMapper.toEntity(doc);
    if (!entity) {
      throw new Error("Failed to map document to ApplicationEntity");
    }
    return entity;
  }

  protected toPersistence(entity: Partial<ApplicationEntity>): Record<string, unknown> {
    return ApplicationMapper.toPersistence(entity);
  }

  async findOwnedById(id: string, userId: string): Promise<ApplicationEntity | null> {
    const idStr = String(id);
    const uidStr = String(userId);
    if (isMongoReady()) {
      const doc = await this.model.findOne({ _id: idStr, userId: uidStr }).lean();
      return doc ? this.toEntity(withApplicationDefaults(doc as Record<string, unknown>)) : null;
    }
    const raw = this.inMemoryStore.get(idStr);
    if (raw && String(raw.userId || "") === uidStr) {
      return this.toEntity(withApplicationDefaults(raw));
    }
    return null;
  }

  async findByUserId(
    userId: string,
    filters: IApplicationFilterOptions = {},
  ): Promise<ApplicationEntity[]> {
    const uid = userId.toString();
    const query: Record<string, unknown> = { userId, archivedAt: null };
    if (filters.stages?.length) query.status = { $in: filters.stages };
    if (filters.priority) query.priority = filters.priority;
    if (filters.pinned === true) query.pinnedAt = { $ne: null };
    if (filters.pinned === false) query.pinnedAt = null;
    const now = new Date();
    if (filters.followUp === "overdue") query.nextFollowUpAt = { $lt: now };
    if (filters.followUp === "due-soon") {
      query.nextFollowUpAt = { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) };
    }

    if (isMongoReady()) {
      const docs = await this.model.find(query).lean();
      return docs.map((d) => this.toEntity(withApplicationDefaults(d as Record<string, unknown>)));
    }

    const apps = [...this.inMemoryStore.values()]
      .filter((a) => String(a.userId || "") === uid && !a.archivedAt)
      .map((d) => this.toEntity(withApplicationDefaults(d)));

    return apps;
  }

  override async create(data: Partial<ApplicationEntity>): Promise<ApplicationEntity> {
    const persistenceData = this.toPersistence(data);
    const uid = String(persistenceData.userId || "");
    if (isMongoReady()) {
      const app = new this.model({
        ...persistenceData,
        lastActivityAt: persistenceData.lastActivityAt || new Date(),
        timeline: [
          { status: persistenceData.status || "saved", changedAt: new Date(), note: "Application created" },
        ],
      });
      const saved = await app.save();
      return this.toEntity(saved.toObject());
    }

    const id = `app_${this.appCounter++}_${Date.now()}`;
    const newApp: Record<string, unknown> = {
      _id: id,
      id,
      ...persistenceData,
      userId: uid,
      status: persistenceData.status || "saved",
      priority: persistenceData.priority || "medium",
      pinnedAt: persistenceData.pinnedAt || null,
      archivedAt: persistenceData.archivedAt || null,
      archiveReason: persistenceData.archiveReason || "",
      source: persistenceData.source || "",
      lastActivityAt: persistenceData.lastActivityAt || new Date(),
      timeline: [
        {
          status: persistenceData.status || "saved",
          changedAt: new Date(),
          note: "Application created",
        },
      ],
      notes: persistenceData.notes || "",
      nextFollowUpAt: persistenceData.nextFollowUpAt || null,
      followUpDraft: persistenceData.followUpDraft || {
        subject: "",
        body: "",
        status: "none",
        sentAt: null,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inMemoryStore.set(id, newApp);
    return this.toEntity(newApp);
  }
}
