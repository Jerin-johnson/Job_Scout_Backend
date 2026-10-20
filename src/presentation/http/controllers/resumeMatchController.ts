import { Request, Response, NextFunction } from "express";
import { acceptRequestQuota } from "../middleware/quotaGate.js";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse } from "../../../shared/types/apiResponse.js";
import {
  createResumeMatchSchema,
  ignoredKeywordSchema,
} from "../../../shared/schemas/resumeMatchSchemas.js";
import { resumeMatchReportService } from "../../../infrastructure/ai/services/resumeMatchReportService.js";

function ownerId(user?: UserRecord): string {
  return String(user?._id || (user as unknown as { id?: string })?.id || "");
}

export const resumeMatchController = {
  createOrFetch: asyncHandler(async (req: Request, res: Response) => {
    const parsed = createResumeMatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message || "Invalid match request.",
          requestId: req.id,
        },
      });
    }
    const user = req.user as UserRecord;
    const userId = ownerId(user);
    const { report, cacheHit, statusCode } = await resumeMatchReportService.createOrFetchReport(
      userId,
      user,
      parsed.data,
    );
    return res.status(statusCode).json(successResponse({ report, cacheHit }));
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as UserRecord;
    const userId = ownerId(user);
    const reports = await resumeMatchReportService.listReports(userId);
    return res.status(200).json(successResponse({ reports }));
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as UserRecord;
    const userId = ownerId(user);
    const report = await resumeMatchReportService.getReport(String(req.params.id), userId);
    if (!report) return res.sendStatus(404);
    return res.status(200).json(successResponse({ report }));
  }),

  ignoreKeywords: asyncHandler(async (req: Request, res: Response) => {
    const parsed = ignoredKeywordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message || "Invalid ignored keyword list.",
          requestId: req.id,
        },
      });
    }
    const user = req.user as UserRecord;
    const userId = ownerId(user);
    const report = await resumeMatchReportService.ignoreKeywords(
      String(req.params.id),
      userId,
      parsed.data,
    );
    if (!report) return res.sendStatus(404);
    return res.status(200).json(successResponse({ report }));
  }),

  suggestions: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const user = req.user as UserRecord;
      const userId = ownerId(user);
      await acceptRequestQuota(req, "resume_match_suggestions");
      const result = await resumeMatchReportService.generateReportSuggestions(
        String(req.params.id),
        userId,
        req.user,
        req.id ? String(req.id) : undefined,
      );
      if (result.errorStatus && result.errorPayload) {
        return res.status(result.errorStatus).json({ error: result.errorPayload });
      }
      if (result.errorStatus === 404) {
        return res.sendStatus(404);
      }
      return res.status(200).json(
        successResponse({
          suggestions: result.suggestions,
          cached: result.cached,
          availability: result.availability,
        }),
      );
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (
        err?.code === "QUOTA_EXCEEDED" ||
        err?.code === "DAILY_BUDGET_EXCEEDED" ||
        err?.code === "GLOBAL_BUDGET_CAP_REACHED" ||
        err?.code === "AI_KILL_SWITCH_ACTIVE" ||
        err?.code === "AI_PROVIDER_NOT_CONFIGURED"
      ) {
        if (err.code === "QUOTA_EXCEEDED")
          return res.status(200).json(
            successResponse({
              suggestions: [],
              cached: false,
              availability: "quota_exhausted",
            }),
          );
        return res.status(503).json({
          error: {
            code: err.code || "AI_SUGGESTIONS_UNAVAILABLE",
            message:
              "AI suggestions are temporarily unavailable. Your deterministic match report is unchanged; try again later.",
            requestId: req.id,
          },
        });
      }
      next(error);
    }
  },

  remove: asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as UserRecord;
    const userId = ownerId(user);
    const deleted = await resumeMatchReportService.deleteReport(String(req.params.id), userId);
    if (!deleted) return res.sendStatus(404);
    return res.status(200).json(successResponse({ deleted: true }));
  }),
};
