import { ResumeEntity } from "../../../../domain/entities/Resume.js";

export class ResumeMapper {
  static toEntity(doc: unknown): ResumeEntity | null {
    if (!doc || typeof doc !== "object") return null;
    const raw = doc as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : raw._id ? String(raw._id) : "";
    const userId = raw.userId ? String(raw.userId) : "";
    const enc = (raw.encryptedRawText || {}) as Record<string, unknown>;
    const summary = (raw.factsSummary || {}) as Record<string, unknown>;

    return {
      id,
      userId,
      fileHash: typeof raw.fileHash === "string" ? raw.fileHash : "",
      originalFilename: typeof raw.originalFilename === "string" ? raw.originalFilename : "",
      mimeType: typeof raw.mimeType === "string" ? raw.mimeType : "",
      s3Key: typeof raw.s3Key === "string" ? raw.s3Key : "",
      encryptedRawText: {
        cipherText: typeof enc.cipherText === "string" ? enc.cipherText : "",
        iv: typeof enc.iv === "string" ? enc.iv : "",
        tag: typeof enc.tag === "string" ? enc.tag : "",
        keyVersion: typeof enc.keyVersion === "string" ? enc.keyVersion : "v1",
      },
      parsedFactsCount: typeof raw.parsedFactsCount === "number" ? raw.parsedFactsCount : 0,
      factsSummary: {
        roles: typeof summary.roles === "number" ? summary.roles : 0,
        skills: typeof summary.skills === "number" ? summary.skills : 0,
        education: typeof summary.education === "number" ? summary.education : 0,
        totalFacts: typeof summary.totalFacts === "number" ? summary.totalFacts : 0,
      },
      isActive: typeof raw.isActive === "boolean" ? raw.isActive : false,
      createdAt:
        raw.createdAt instanceof Date
          ? raw.createdAt
          : new Date(String(raw.createdAt || Date.now())),
      updatedAt:
        raw.updatedAt instanceof Date
          ? raw.updatedAt
          : new Date(String(raw.updatedAt || Date.now())),
    };
  }

  static toPersistence(entity: Partial<ResumeEntity>): Record<string, unknown> {
    const data: Record<string, unknown> = { ...entity };
    if (data.id) {
      data._id = data.id;
      delete data.id;
    }
    return data;
  }
}
