import { Model, Document } from "mongoose";
import { isMongoReady } from "../../../../config/database.js";
import { IBaseRepository } from "../../../../domain/repositories/IBaseRepository.js";

export abstract class BaseMongooseRepository<
  TDocument extends Document,
  TEntity,
  TId = string
> implements IBaseRepository<TEntity, TId> {
  protected inMemoryStore: Map<string, Record<string, unknown>> = new Map();

  constructor(protected readonly model: Model<TDocument>) {}

  protected abstract toEntity(doc: unknown): TEntity;
  protected abstract toPersistence(entity: Partial<TEntity>): Record<string, unknown>;

  async findById(id: TId): Promise<TEntity | null> {
    const idStr = String(id);
    if (isMongoReady()) {
      const doc = await this.model.findById(idStr).lean();
      return doc ? this.toEntity(doc) : null;
    }
    const raw = this.inMemoryStore.get(idStr);
    return raw ? this.toEntity(raw) : null;
  }

  async create(item: Partial<TEntity>): Promise<TEntity> {
    const persistenceData = this.toPersistence(item);
    if (isMongoReady()) {
      const created = await this.model.create(persistenceData);
      return this.toEntity(created);
    }
    const id = String(persistenceData._id || persistenceData.id || `mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const entity: Record<string, unknown> = {
      ...persistenceData,
      _id: id,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inMemoryStore.set(id, entity);
    return this.toEntity(entity);
  }

  async update(id: TId, updates: Partial<TEntity>): Promise<TEntity | null> {
    const idStr = String(id);
    const persistenceUpdates = this.toPersistence(updates);
    if (isMongoReady()) {
      const updated = await this.model
        .findByIdAndUpdate(idStr, { $set: persistenceUpdates }, { new: true })
        .lean();
      return updated ? this.toEntity(updated) : null;
    }
    const existing = this.inMemoryStore.get(idStr);
    if (!existing) return null;
    const merged: Record<string, unknown> = { ...existing, ...persistenceUpdates, updatedAt: new Date() };
    this.inMemoryStore.set(idStr, merged);
    return this.toEntity(merged);
  }

  async delete(id: TId): Promise<boolean> {
    const idStr = String(id);
    if (isMongoReady()) {
      const res = await this.model.findByIdAndDelete(idStr);
      return Boolean(res);
    }
    return this.inMemoryStore.delete(idStr);
  }
}
