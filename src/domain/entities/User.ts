import { IBaseEntity } from "../../shared/types/index.js";

export interface IRefreshTokenMeta {
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  isRevoked?: boolean;
  createdAt?: Date;
}

export interface UserEntity extends IBaseEntity {
  email: string;
  passwordHash: string | null;
  googleId: string | null;
  name: string;
  preferredName: string;
  role: string;
  plan: string;
  planSource: string;
  planVersion: number;
  profileVersion: number;
  failedLoginAttempts: number;
  lockUntil: Date | null;
  refreshTokens: IRefreshTokenMeta[];
  memoryPaused: boolean;
  isDeleted: boolean;
}
