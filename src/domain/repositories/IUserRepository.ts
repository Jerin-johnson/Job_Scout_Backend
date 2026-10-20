import { UserEntity, IRefreshTokenMeta } from "../entities/User.js";
import { IBaseRepository } from "./IBaseRepository.js";

export interface IUserRepository extends IBaseRepository<UserEntity, string> {
  findByEmail(email: string): Promise<UserEntity | null>;
  bumpProfileVersion(id: string): Promise<UserEntity | null>;
  recordFailedLogin(id: string, currentAttempts: number): Promise<UserEntity | null>;
  resetFailedLogins(id: string): Promise<UserEntity | null>;
  addRefreshToken(id: string, tokenMeta: IRefreshTokenMeta): Promise<UserEntity | null>;
  revokeTokenFamily(id: string, familyId: string): Promise<UserEntity | null>;
  setEmailVerificationOtp(id: string, otpHash: string, expiresAt: Date): Promise<UserEntity | null>;
  verifyEmail(id: string): Promise<UserEntity | null>;
}
