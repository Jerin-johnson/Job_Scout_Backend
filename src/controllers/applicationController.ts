import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { applicationRepository, ApplicationRecord, ApplicationFilters } from "../repositories/applicationRepository.js";
import { applicationGraph } from "../ai/graphs/applicationGraph.js";
import { get, set, del, CacheKeys, TTL } from "../shared/cache.js";
import { logger } from "../shared/utils/logger.js";
import {
  scheduleApplicationReminder,
  cancelApplicationReminder,
} from "../services/applicationReminderQueue.js";
import { applicationReminderTransition } from "../services/applicationLifecycle.js";
import { invalidateCandidateContext } from "../ai/candidateContext.js";
import { Job } from "../models/Job.js";
import { recordInteraction } from "../services/jobs/interactionEvents.js";
import { UserRecord } from "../repositories/userRepository.js";

const VALID_STATUSES = ["saved", "applied", "screening", "interviewing", "offer", "rejected"] as const;
const optionalDate = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.union([z.null(), z.coerce.date()]),
);
const optionalSalary = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.union([z.null(), z.coerce.number().finite().nonnegative()]),
);

const CreateApplicationSchema = z.object({
  jobId: z.string().min(1).optional(),
  company: z.string().min(1, "company is required"),
  role: z.string().min(1, "role is required"),
  status: z.enum(VALID_STATUSES).optional().default("saved"),
  priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
  source: z.string().max(120).optional().default(""),
  location: z.string().max(160).optional().default(""),
  salaryMin: optionalSalary.optional(),
  salaryMax: optionalSalary.optional(),
  notes: z.string().optional().default(""),
  jobUrl: z.string().url().optional().or(z.literal("")),
  hrPhone: z.string().max(40).optional().default(""),
  companyEmail: z.string().email().optional().or(z.literal("")),
  nextFollowUpAt: optionalDate.optional(),
  reminderEnabled: z.boolean().optional().default(false),
});

const UpdateApplicationSchema = z.object({
  priority: z.enum(["high", "medium", "low"]).optional(),
  location: z.string().max(160).optional(),
  salaryMin: optionalSalary.optional(),
  salaryMax: optionalSalary.optional(),
  pinnedAt: optionalDate.optional(),
  source: z.string().max(120).optional(),
  notes: z.string().max(5000).optional(),
  jobUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  hrPhone: z.string().max(40).optional(),
  companyEmail: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  nextFollowUpAt: optionalDate.optional(),
  reminderEnabled: z.boolean().optional(),
});

const ArchiveApplicationSchema = z.object({
  archived: z.boolean().optional().default(true),
  reason: z.enum(["withdrawn", "ghosted", "no_longer_interested", ""]).optional().default(""),
});

const UpdateStatusSchema = z.object({
  status: z.enum(VALID_STATUSES),
  note: z.string().optional().default(""),
});

function getUserId(user?: UserRecord): string {
  if (!user) return "";
  return user._id ? user._id.toString() : (user as unknown as { id?: string }).id ? (user as unknown as { id?: string }).id!.toString() : "";
}

export const applicationController = {
  /**
   * GET /api/v1/applications
   * Retrieves candidate's Kanban board applications, grouped by status
   */
  async getApplications(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const allowedSort = new Set(["recommended", "recent", "follow-up", "priority"]);
      const querySort = typeof req.query.sort === "string" ? req.query.sort : "recommended";
      const sort = allowedSort.has(querySort) ? querySort : "recommended";
      const stages = String(req.query.stage || "")
        .split(",")
        .filter((stage): stage is (typeof VALID_STATUSES)[number] => VALID_STATUSES.includes(stage as (typeof VALID_STATUSES)[number]));
      const filters: ApplicationFilters = {
        search: String(req.query.q || "")
          .trim()
          .slice(0, 100),
        stages,
        priority: ["high", "medium", "low"].includes(String(req.query.priority))
          ? String(req.query.priority)
          : undefined,
        pinned:
          req.query.pinned === "true" ? true : req.query.pinned === "false" ? false : undefined,
        followUp: ["overdue", "due-soon"].includes(String(req.query.followUp))
          ? (String(req.query.followUp) as "overdue" | "due-soon")
          : undefined,
        stale: req.query.stale === "true",
        appliedSinceDays: req.query.appliedSinceDays === "7" ? 7 : undefined,
        staleDays: Math.max(1, Number(process.env.APPLICATION_STALE_DAYS || 7)),
        sort,
      };
      const cacheKey = CacheKeys.response(userId, "kanban", 1);

      // Preserve the low-latency cache for the default board only.
      const isDefaultQuery =
        !filters.search &&
        !stages.length &&
        !filters.priority &&
        filters.pinned === undefined &&
        !filters.followUp &&
        !filters.stale &&
        !filters.appliedSinceDays &&
        sort === "recommended";
      const cached = isDefaultQuery ? await get(cacheKey) : null;
      if (cached) {
        return res.status(200).json({ data: { ...(cached as Record<string, unknown>), fromCache: true } });
      }

      const [applications, stats] = await Promise.all([
        applicationRepository.findByUserId(userId, filters),
        applicationRepository.getBoardStats(userId),
      ]);

      // Group into Kanban columns
      const columns: Record<string, ApplicationRecord[]> = {
        saved: [],
        applied: [],
        screening: [],
        interviewing: [],
        offer: [],
        rejected: [],
      };

      for (const app of applications) {
        const col = (app.status && columns[app.status]) ? app.status : "saved";
        columns[col].push(app);
      }

      const result = {
        total: applications.length,
        columns,
        applications,
        stats,
      };

      // Cache for 60s
      if (isDefaultQuery) await set(cacheKey, result, TTL.RESPONSE);

      return res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/applications
   * Track a new application
   */
  async createApplication(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = CreateApplicationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      }

      if (
        parsed.data.salaryMin !== null &&
        parsed.data.salaryMin !== undefined &&
        parsed.data.salaryMax !== null &&
        parsed.data.salaryMax !== undefined &&
        parsed.data.salaryMin > parsed.data.salaryMax
      ) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Maximum salary must be at least minimum salary",
            requestId: req.id,
          },
        });
      }

      const user = req.user as UserRecord;
      const userId = getUserId(user);
      if (parsed.data.reminderEnabled && !parsed.data.nextFollowUpAt) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "A follow-up date is required to schedule a reminder",
            requestId: req.id,
          },
        });
      }
      let app = await applicationRepository.create({
        ...parsed.data,
        jobId: parsed.data.jobId || `manual_${randomUUID()}`,
        userId,
        reminderStatus: parsed.data.reminderEnabled ? "scheduled" : "none",
      });
      const trackedJobId = parsed.data.jobId && mongoose.isValidObjectId(parsed.data.jobId) ? parsed.data.jobId : null;
      const trackedJob = trackedJobId ? await Job.findById(trackedJobId).select("sourceBoard occupation structuredLocation.countryCode").lean() : null;
      const analyticsConsent = user?.jobAnalyticsConsent as { version?: string } | undefined;
      await (
        recordInteraction as (opts: unknown) => Promise<unknown>
      )({
        userId,
        consented: analyticsConsent?.version === "job-analytics-v1",
        event: "save",
        source: (trackedJob as unknown as { sourceBoard?: string })?.sourceBoard,
        occupation: (trackedJob as unknown as { occupation?: string })?.occupation,
        country: (trackedJob as unknown as { structuredLocation?: { countryCode?: string } })?.structuredLocation?.countryCode,
      });
      if (app.reminderEnabled) {
        try {
          await scheduleApplicationReminder(app);
        } catch (error: unknown) {
          const err = error as Error;
          app = (await applicationRepository.update(app._id, { reminderStatus: "failed" })) || app;
          logger.warn(
            { appId: app._id, error: err.message },
            "Application created, but its reminder could not be scheduled",
          );
        }
      }
      await del(CacheKeys.response(userId, "kanban", 1));
      await invalidateCandidateContext(userId);

      logger.info({ userId, appId: app._id, company: app.company }, "Application created");

      return res.status(201).json({
        data: {
          message: "Application tracked successfully",
          application: app,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/applications/:id
   */
  async getApplicationById(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const appId = String(req.params.id);
      const app = await applicationRepository.findOwnedById(appId, userId);
      if (!app) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      return res.status(200).json({ data: { application: app } });
    } catch (err) {
      next(err);
    }
  },

  async updateApplication(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = UpdateApplicationSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const appId = String(req.params.id);
      const app = await applicationRepository.findOwnedById(appId, userId);
      if (!app)
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      const updates = { ...parsed.data } as Partial<ApplicationRecord>;
      const salaryMin = Object.hasOwn(updates, "salaryMin") ? updates.salaryMin : app.salaryMin;
      const salaryMax = Object.hasOwn(updates, "salaryMax") ? updates.salaryMax : app.salaryMax;
      if (
        salaryMin !== null &&
        salaryMin !== undefined &&
        salaryMax !== null &&
        salaryMax !== undefined &&
        salaryMin > salaryMax
      )
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Maximum salary must be at least minimum salary",
            requestId: req.id,
          },
        });
      const enabled = updates.reminderEnabled ?? app.reminderEnabled ?? false;
      const dueAt = Object.hasOwn(updates, "nextFollowUpAt")
        ? updates.nextFollowUpAt
        : app.nextFollowUpAt;
      if (enabled && !dueAt)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "A follow-up date is required to schedule a reminder",
            requestId: req.id,
          },
        });
      const reminderTransition = (
        applicationReminderTransition as (opts: unknown) => {
          cancel?: boolean;
          schedule?: boolean;
          enabled?: boolean;
        }
      )({
        application: app,
        nextFollowUpAt: dueAt,
        reminderEnabled: enabled,
      });
      if (reminderTransition.cancel) {
        updates.reminderStatus = reminderTransition.enabled ? "scheduled" : "none";
        updates.reminderSentAt = null;
      }
      const updated = (await applicationRepository.update(appId, updates, {
        activity: true,
      })) as ApplicationRecord;
      if (reminderTransition.cancel) await cancelApplicationReminder(app);
      if (reminderTransition.schedule) {
        try {
          await scheduleApplicationReminder(updated);
        } catch (error: unknown) {
          const err = error as Error;
          updated.reminderStatus = "failed";
          updated.reminderSentAt = null;
          await applicationRepository.update(appId, { reminderStatus: "failed" });
          logger.warn(
            { appId, error: err.message },
            "Application saved, but its reminder could not be scheduled",
          );
        }
      }
      await del(CacheKeys.response(userId, "kanban", 1));
      await invalidateCandidateContext(userId);
      return res.status(200).json({ data: { application: updated } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/v1/applications/:id/status
   * Update application pipeline stage and trigger Graph D
   */
  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = UpdateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      }

      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const appId = String(req.params.id);
      const app = await applicationRepository.findOwnedById(appId, userId);
      if (!app) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      let updated = (await applicationGraph.handleStageChange({
        application: app,
        user: req.user,
        newStatus: parsed.data.status,
        note: parsed.data.note,
      })) as ApplicationRecord;
      const reminderTransition = (
        applicationReminderTransition as (opts: unknown) => {
          cancel?: boolean;
          schedule?: boolean;
          terminal?: boolean;
        }
      )({
        application: app,
        status: parsed.data.status,
        nextFollowUpAt: updated?.nextFollowUpAt,
      });
      if (reminderTransition.terminal) {
        updated = (await applicationRepository.update(app._id, {
          reminderEnabled: false,
          reminderStatus: "none",
        })) as ApplicationRecord;
        if (reminderTransition.cancel) await cancelApplicationReminder(app);
      } else {
        if (reminderTransition.cancel) await cancelApplicationReminder(app);
        if (reminderTransition.schedule) {
          try {
            await scheduleApplicationReminder(updated);
          } catch (error: unknown) {
            const err = error as Error;
            updated =
              (await applicationRepository.update(app._id, { reminderStatus: "failed" })) ||
              updated;
            logger.warn(
              { appId: app._id, error: err.message },
              "Updated follow-up reminder could not be scheduled",
            );
          }
        }
      }
      await del(CacheKeys.response(userId, "kanban", 1));
      await invalidateCandidateContext(userId);

      return res.status(200).json({
        data: {
          message: `Application moved to ${parsed.data.status}`,
          application: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/applications/:id/follow-up/approve
   * Human approval to send drafted follow-up email
   */
  async approveFollowUp(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const appId = String(req.params.id);
      const app = await applicationRepository.findOwnedById(appId, userId);
      if (!app) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      const sent = await applicationGraph.sendApprovedEmail({
        application: app,
        user: req.user,
      });
      await del(CacheKeys.response(userId, "kanban", 1));
      await invalidateCandidateContext(userId);

      return res.status(200).json({
        data: {
          message: "Follow-up email approved and dispatched successfully",
          application: sent,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async archiveApplication(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = ArchiveApplicationSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const appId = String(req.params.id);
      const app = await applicationRepository.findOwnedById(appId, userId);
      if (!app)
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      const reminderTransition = (
        applicationReminderTransition as (opts: unknown) => {
          cancel?: boolean;
          schedule?: boolean;
          terminal?: boolean;
        }
      )({
        application: app,
        archived: parsed.data.archived,
      });
      const updated = await applicationRepository.update(
        app._id,
        parsed.data.archived
          ? {
              archivedAt: new Date(),
              archiveReason: parsed.data.reason,
              reminderEnabled: false,
              reminderStatus: "none",
            }
          : { archivedAt: null, archiveReason: "" },
        { activity: true },
      );
      if (reminderTransition.cancel) await cancelApplicationReminder(app);
      await del(CacheKeys.response(userId, "kanban", 1));
      await invalidateCandidateContext(userId);
      return res.status(200).json({ data: { application: updated } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/applications/:id
   */
  async deleteApplication(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const appId = String(req.params.id);
      const app = await applicationRepository.findOwnedById(appId, userId);
      if (!app) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      await applicationRepository.delete(appId);
      await cancelApplicationReminder(app);
      await del(CacheKeys.response(userId, "kanban", 1));
      await invalidateCandidateContext(userId);
      return res.status(200).json({
        data: { message: "Application deleted successfully", id: appId },
      });
    } catch (err) {
      next(err);
    }
  },
};
