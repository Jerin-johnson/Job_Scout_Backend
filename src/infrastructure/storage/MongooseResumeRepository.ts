import { injectable } from "tsyringe";
import { IResumeRepository } from "../../domain/repositories/IResumeRepository.js";
import { JobMatchReport } from "../database/mongoose/models/JobMatchReportModel.js";
import { Profile } from "../database/mongoose/models/ProfileModel.js";
import { Resume } from "../database/mongoose/models/ResumeModel.js";
import { CacheKeys, del } from "../../shared/cache.js";
import { storageService } from "./storageService.js";
import { enqueueMatchRefreshForUser } from "../database/mongoose/repositories/MongooseMatchRefreshRepository.js";
import { invalidateCandidateContext } from "../ai/candidateContext.js";
import { userRepository } from "../database/mongoose/repositories/MongooseUserRepository.js";
import { isMongoReady } from "../database/database.js";

export async function deleteResumeForUser({
  resumeId,
  userId,
}: {
  resumeId: string;
  userId: string;
}): Promise<boolean> {
  if (!isMongoReady()) return false;
  const resume = await Resume.findOne({ _id: resumeId, userId }).lean();
  if (!resume) return false;
  await storageService.deleteFile({ key: resume.s3Key });
  await JobMatchReport.deleteMany({ userId, resumeId: resume._id });
  await Resume.deleteOne({ _id: resume._id, userId });
  await del(CacheKeys.resumeParse(`${userId}:${resume.fileHash}:resume-match-v1`));
  await Profile.updateOne(
    { userId },
    { $set: { roles: [], skills: [], education: [] }, $inc: { version: 1 } },
  );
  await invalidateCandidateContext(userId);
  const updatedUser = await userRepository.bumpProfileVersion(userId);
  if (updatedUser) await enqueueMatchRefreshForUser(userId, updatedUser.profileVersion);
  return true;
}

export async function deleteAllUserResumeData(userId: string): Promise<number> {
  if (!isMongoReady()) return 0;
  const resumes = (await Resume.find({ userId }).select("_id s3Key fileHash").lean()) as Array<{
    _id: unknown;
    s3Key: string;
    fileHash: string;
  }>;
  for (let offset = 0; offset < resumes.length; offset += 10) {
    await Promise.all(
      resumes
        .slice(offset, offset + 10)
        .map((resume) => storageService.deleteFile({ key: resume.s3Key })),
    );
  }
  await JobMatchReport.deleteMany({ userId });
  await Resume.deleteMany({ userId });
  for (const resume of resumes)
    await del(CacheKeys.resumeParse(`${userId}:${resume.fileHash}:resume-match-v1`));
  return resumes.length;
}

@injectable()
export class MongooseResumeRepository implements IResumeRepository {
  async deleteResumeForUser(options: { resumeId: string; userId: string }): Promise<boolean> {
    return deleteResumeForUser(options);
  }

  async deleteAllUserResumeData(userId: string): Promise<number> {
    return deleteAllUserResumeData(userId);
  }
}

export const resumeRepository = new MongooseResumeRepository();
