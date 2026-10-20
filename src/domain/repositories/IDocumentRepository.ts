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

export interface IDocumentRepository {
  saveDoc(docData: Record<string, unknown>): Promise<StoredDoc>;
  findDoc(id: string): Promise<StoredDoc | null>;
  updateDoc(id: string, updates: Record<string, unknown>): Promise<StoredDoc | null>;
  listDocs(userId?: string): Promise<StoredDoc[]>;
}
