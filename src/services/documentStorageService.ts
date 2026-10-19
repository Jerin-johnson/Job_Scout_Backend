import mongoose from "mongoose";
import { Document } from "../infrastructure/database/mongoose/models/DocumentModel.js";

export interface StoredDoc {
  _id: string;
  userId?: string;
  jobId?: string;
  jobTitle?: string;
  company?: string;
  type?: string;
  status?: string;
  tailoredBullets?: unknown[];
  atsMatchScore?: number;
  atsKeywordsCovered?: string[];
  pdfStorageUrl?: string;
  docxStorageUrl?: string;
  approvedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

// In-memory document store for offline/test mode
const inMemoryDocs = new Map<string, StoredDoc>();
let docCounter = 1;

function isMongoReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export const documentStorageService = {
  async saveDoc(docData: Record<string, unknown>): Promise<StoredDoc> {
    if (isMongoReady()) {
      const doc = new Document(docData);
      return (await doc.save()).toObject() as StoredDoc;
    }
    const id = `doc_${docCounter++}_${Date.now()}`;
    const stored: StoredDoc = { _id: id, ...docData, createdAt: new Date(), updatedAt: new Date() };
    inMemoryDocs.set(id, stored);
    return stored;
  },

  async findDoc(id: string): Promise<StoredDoc | null> {
    if (isMongoReady()) {
      return (await Document.findById(id).lean()) as StoredDoc | null;
    }
    return inMemoryDocs.get(id) || null;
  },

  async updateDoc(id: string, updates: Record<string, unknown>): Promise<StoredDoc | null> {
    if (isMongoReady()) {
      return (await Document.findByIdAndUpdate(
        id,
        { ...updates, updatedAt: new Date() },
        { new: true },
      ).lean()) as StoredDoc | null;
    }
    const existing = inMemoryDocs.get(id);
    if (!existing) return null;
    const updated: StoredDoc = { ...existing, ...updates, updatedAt: new Date() };
    inMemoryDocs.set(id, updated);
    return updated;
  },

  async listDocs(userId?: string): Promise<StoredDoc[]> {
    if (isMongoReady()) {
      return (await Document.find({ userId }).sort({ createdAt: -1 }).lean()) as StoredDoc[];
    }
    const uid = userId?.toString();
    return [...inMemoryDocs.values()]
      .filter((d) => d.userId?.toString() === uid)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  },
};
