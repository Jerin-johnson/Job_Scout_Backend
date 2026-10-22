import { IBaseEntity } from "../../shared/types/index.js";

export interface IEncryptedRawText {
  cipherText: string;
  iv: string;
  tag: string;
  keyVersion?: string;
}

export interface IFactsSummary {
  roles: number;
  skills: number;
  education: number;
  totalFacts: number;
}

export interface ResumeEntity extends IBaseEntity {
  userId: string;
  fileHash: string;
  originalFilename: string;
  mimeType: string;
  s3Key: string;
  encryptedRawText: IEncryptedRawText;
  parsedFactsCount: number;
  factsSummary: IFactsSummary;
  isActive?: boolean;
}
