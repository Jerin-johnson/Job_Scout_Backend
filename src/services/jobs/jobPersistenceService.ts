import mongoose from "mongoose";
import { Job } from "../../infrastructure/database/mongoose/models/JobModel.js";
import { JobDetail } from "../../infrastructure/database/mongoose/models/JobDetailModel.js";
import { JobVector } from "../../infrastructure/database/mongoose/models/JobVectorModel.js";
import { HiddenJob } from "../../infrastructure/database/mongoose/models/HiddenJobModel.js";

export interface LoadedJobDetails {
  job: Record<string, unknown> | null;
  canonicalJob: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  alsoListedOn: Array<{ source?: string; url?: string }>;
}

export const jobPersistenceService = {
  async getHiddenJobIds(userId: string): Promise<string[]> {
    const ids = await HiddenJob.distinct("jobId", { userId });
    return ids.map((id) => String(id));
  },

  async hideJob(userId: string, jobId: unknown): Promise<void> {
    await HiddenJob.updateOne(
      { userId, jobId },
      { $setOnInsert: { userId, jobId } },
      { upsert: true },
    );
  },

  async findActiveJobById(id: string): Promise<Record<string, unknown> | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return (await Job.findOne({
      _id: id,
      status: "active",
      expiresAt: { $gt: new Date() },
    })
      .select("-embedding -rawPayload")
      .lean()) as Record<string, unknown> | null;
  },

  async loadJobDetails(id: string): Promise<LoadedJobDetails | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const job = (await Job.findOne({
      _id: id,
      status: "active",
      expiresAt: { $gt: new Date() },
    })
      .select("-embedding -rawPayload")
      .lean()) as Record<string, unknown> | null;

    if (!job) return null;

    const canonicalJob = (
      job.canonicalJobId
        ? await Job.findOne({
            _id: job.canonicalJobId as string,
            status: "active",
            expiresAt: { $gt: new Date() },
          })
            .select("sourceBoard sourceUrl canonicalUrl variants")
            .lean()
        : job
    ) as Record<string, unknown> | null;

    const variantLinks = [
      ...(canonicalJob?._id && String(canonicalJob._id) !== String(job._id)
        ? [
            {
              source: canonicalJob.sourceBoard as string | undefined,
              url: (canonicalJob.sourceUrl || canonicalJob.canonicalUrl || "") as string,
            },
          ]
        : []),
      ...((canonicalJob?.variants as Array<{ source?: string; url?: string }>) || []),
    ];

    const alsoListedOn = variantLinks
      .filter(
        (variant) =>
          variant.source !== job?.sourceBoard ||
          variant.url !== (job?.sourceUrl || job?.canonicalUrl || ""),
      )
      .slice(0, 10);

    const detail = (await JobDetail.findOne({ jobId: job._id, expiresAt: { $gt: new Date() } })
      .select("description requirements provenance")
      .lean()) as Record<string, unknown> | null;

    return { job, canonicalJob, detail, alsoListedOn };
  },

  async findSimilarJobs(jobId: unknown, sourceBoard: unknown): Promise<Record<string, unknown>[]> {
    return (await Job.find({
      _id: { $ne: jobId },
      status: "active",
      expiresAt: { $gt: new Date() },
      $or: [{ features: { $exists: true, $ne: {} } }, { sourceBoard }],
    })
      .select(
        "title company location sourceBoard sourceUrl postedAt postedDateKnown salaryRange requirements tags features",
      )
      .limit(100)
      .lean()) as Record<string, unknown>[];
  },

  async findJobById(id: string): Promise<{ _id: unknown } | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return (await Job.findOne({ _id: id }).select("_id").lean()) as { _id: unknown } | null;
  },

  async incrementJobClicks(id: unknown): Promise<void> {
    await Job.updateOne({ _id: id }, { $inc: { clicks: 1 } });
  },

  async incrementJobReports(id: unknown, reason: string): Promise<void> {
    await Job.updateOne(
      { _id: id },
      {
        $inc: { reportsCount: 1, [`reportCounts.${reason}`]: 1, [`reportsBreakdown.${reason}`]: 1 },
      },
    );
  },

  async findJobSummary(id: unknown): Promise<Record<string, unknown> | null> {
    return (await Job.findById(id)
      .select("sourceBoard occupation structuredLocation.countryCode")
      .lean()) as Record<string, unknown> | null;
  },

  async findActiveCatalogSample(): Promise<Record<string, unknown>[]> {
    return (await Job.find({ status: "active", expiresAt: { $gt: new Date() } })
      .select("title features")
      .lean()) as Record<string, unknown>[];
  },

  async countVectorsForJobs(jobIds: unknown[]): Promise<number> {
    if (!jobIds.length) return 0;
    return await JobVector.countDocuments({
      jobId: { $in: jobIds },
    });
  },
};
