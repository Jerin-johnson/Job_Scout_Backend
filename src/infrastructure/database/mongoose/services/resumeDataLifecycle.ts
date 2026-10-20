import { JobMatchReport } from "../models/JobMatchReportModel.js";
import { Profile } from "../models/ProfileModel.js";
import { Resume } from "../models/ResumeModel.js";
import { CacheKeys, del } from "../../../../shared/cache.js";
import { storageService } from "../../../storage/storageService.js";
import { enqueueMatchRefreshForUser } from "./matchRefreshService.js";
import { invalidateCandidateContext } from "../../../ai/candidateContext.js";
import { userRepository } from "../repositories/MongooseUserRepository.js";
import { isMongoReady } from "../../database.js";

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
  // Profile facts do not yet carry source-resume provenance. Clear all extracted
  // facts on any resume removal rather than leave facts from the deleted source.
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
