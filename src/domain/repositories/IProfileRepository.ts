import { ProfileEntity } from "../entities/Profile.js";
import { ResumeEntity } from "../entities/Resume.js";

export interface IProfileRepository {
  findByUserId(userId: string): Promise<ProfileEntity | null>;
  upsertProfile(userId: string, profileData: Partial<ProfileEntity>): Promise<ProfileEntity>;
  createResume(resumeData: Partial<ResumeEntity>): Promise<ResumeEntity>;
  findResumesByUserId(userId: string): Promise<ResumeEntity[]>;
  findResumeByIdAndUserId(resumeId: string, userId: string): Promise<ResumeEntity | null>;
  findResumeByS3KeyAndUserId(s3Key: string, userId: string): Promise<ResumeEntity | null>;
}
