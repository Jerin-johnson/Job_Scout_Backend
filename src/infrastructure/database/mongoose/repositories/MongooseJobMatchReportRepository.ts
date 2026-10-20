import { injectable } from "tsyringe";
import mongoose from "mongoose";
import { IJobMatchReportRepository } from "../../../../domain/repositories/IJobMatchReportRepository.js";
import { JobMatchReport } from "../models/JobMatchReportModel.js";
import { isMongoReady } from "../../database.js";

const inMemoryReports = new Map<string, Record<string, unknown>>();
let reportCounter = 1;

@injectable()
export class MongooseJobMatchReportRepository implements IJobMatchReportRepository {
  async findReportById(reportId: string, userId: string): Promise<Record<string, unknown> | null> {
    if (isMongoReady()) {
      if (!mongoose.isValidObjectId(reportId)) return null;
      return (await JobMatchReport.findOne({ _id: reportId, userId }).lean()) as Record<
        string,
        unknown
      > | null;
    }
    const report = inMemoryReports.get(reportId);
    if (!report || report.userId !== userId) return null;
    return report;
  }

  async findReportByResumeAndJob(
    userId: string,
    resumeId: string,
    jobHash: string,
  ): Promise<Record<string, unknown> | null> {
    if (isMongoReady()) {
      return (await JobMatchReport.findOne({ userId, resumeId, jobHash }).lean()) as Record<
        string,
        unknown
      > | null;
    }
    for (const report of inMemoryReports.values()) {
      if (report.userId === userId && report.resumeId === resumeId && report.jobHash === jobHash) {
        return report;
      }
    }
    return null;
  }

  async saveReport(reportData: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (isMongoReady()) {
      const created = await JobMatchReport.create(reportData);
      return created.toObject() as Record<string, unknown>;
    }
    const id = String(reportData._id || `report_${reportCounter++}`);
    const stored = { _id: id, ...reportData, createdAt: new Date() };
    inMemoryReports.set(id, stored);
    return stored;
  }

  async updateIgnoredKeywords(
    reportId: string,
    userId: string,
    keywords: unknown[],
    scoreResult: unknown,
  ): Promise<Record<string, unknown> | null> {
    if (isMongoReady()) {
      return (await JobMatchReport.findOneAndUpdate(
        { _id: reportId, userId },
        { $set: { ignoredKeywords: keywords, match: scoreResult, updatedAt: new Date() } },
        { new: true },
      ).lean()) as Record<string, unknown> | null;
    }
    const report = inMemoryReports.get(reportId);
    if (!report || report.userId !== userId) return null;
    report.ignoredKeywords = keywords;
    report.match = scoreResult;
    report.updatedAt = new Date();
    return report;
  }

  async deleteByUserId(userId: string): Promise<number> {
    if (isMongoReady()) {
      const res = await JobMatchReport.deleteMany({ userId });
      return res.deletedCount || 0;
    }
    let count = 0;
    for (const [id, report] of inMemoryReports.entries()) {
      if (report.userId === userId) {
        inMemoryReports.delete(id);
        count++;
      }
    }
    return count;
  }

  async deleteByResumeId(userId: string, resumeId: unknown): Promise<number> {
    if (isMongoReady()) {
      const res = await JobMatchReport.deleteMany({ userId, resumeId });
      return res.deletedCount || 0;
    }
    let count = 0;
    for (const [id, report] of inMemoryReports.entries()) {
      if (report.userId === userId && String(report.resumeId) === String(resumeId)) {
        inMemoryReports.delete(id);
        count++;
      }
    }
    return count;
  }
}

export const jobMatchReportRepository = new MongooseJobMatchReportRepository();
