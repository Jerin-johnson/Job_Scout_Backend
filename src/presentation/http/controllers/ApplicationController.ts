import { Request, Response, NextFunction } from "express";
import { injectable, inject } from "tsyringe";
import { z } from "zod";
import { AuthenticatedRequest } from "../types/index.js";
import { GetApplicationsUseCase } from "../../../application/useCases/applications/GetApplicationsUseCase.js";
import { CreateApplicationUseCase } from "../../../application/useCases/applications/CreateApplicationUseCase.js";
import { UpdateApplicationStatusUseCase } from "../../../application/useCases/applications/UpdateApplicationStatusUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";
import { applicationGraph } from "../../../ai/graphs/applicationGraph.js";
import {
  applicationRepository,
  ApplicationRecord,
  ApplicationFilters,
} from "../../../infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js";
import { applicationReminderTransition } from "../../../services/applicationLifecycle.js";
import {
  scheduleApplicationReminder,
  cancelApplicationReminder,
} from "../../../services/applicationReminderQueue.js";
import { logger } from "../../../shared/utils/logger.js";
import { del, CacheKeys } from "../../../shared/cache.js";
import { invalidateCandidateContext } from "../../../ai/candidateContext.js";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";

const optionalDate = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.union([z.null(), z.coerce.date()]),
);
const optionalSalary = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.union([z.null(), z.coerce.number().finite().nonnegative()]),
);

const CreateApplicationSchema = z.object({
  jobId: z.string().optional(),
  company: z.string().min(1, "Company is required"),
  role: z.string().min(1, "Role is required"),
  location: z.string().optional(),
  salary: z.string().optional(),
  salaryMin: optionalSalary.optional(),
  salaryMax: optionalSalary.optional(),
  url: z.string().url().optional().or(z.literal("")),
  jobUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  source: z.string().optional(),
  status: z
    .enum(["saved", "applied", "screening", "interviewing", "offer", "rejected", "ghosted"])
    .default("saved"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  pinned: z.boolean().default(false),
  pinnedAt: optionalDate.optional(),
  notes: z.string().max(5000).optional(),
  nextFollowUpAt: optionalDate.optional(),
  reminderEnabled: z.boolean().default(false),
});

const UpdateApplicationSchema = z.object({
  company: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  location: z.string().optional(),
  salary: z.string().optional(),
  salaryMin: optionalSalary.optional(),
  salaryMax: optionalSalary.optional(),
  url: z.string().url().optional().or(z.literal("")).or(z.null()),
  jobUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  source: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  pinned: z.boolean().optional(),
  pinnedAt: optionalDate.optional(),
  notes: z.string().max(5000).optional(),
  nextFollowUpAt: optionalDate.optional(),
  reminderEnabled: z.boolean().optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(["saved", "applied", "screening", "interviewing", "offer", "rejected", "ghosted"]),
  note: z.string().max(1000).optional(),
});

const ArchiveApplicationSchema = z.object({
  archived: z.boolean(),
  reason: z.string().max(500).optional(),
});

function getUserId(user: UserRecord): string {
  if (user && user._id) return user._id.toString();
  if (user && (user as unknown as { id?: string }).id)
    return String((user as unknown as { id?: string }).id);
  throw new UnauthorizedError("User identification missing");
}

@injectable()
export class ApplicationController {
  constructor(
    @inject(TOKENS.GetApplicationsUseCase)
    private readonly getApplicationsUseCase: GetApplicationsUseCase,
    @inject(TOKENS.CreateApplicationUseCase)
    private readonly createApplicationUseCase: CreateApplicationUseCase,
    @inject(TOKENS.UpdateApplicationStatusUseCase)
    private readonly updateApplicationStatusUseCase: UpdateApplicationStatusUseCase,
  ) {}

  list = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("User authentication required");
      }

      const query = req.query as Record<string, string | undefined>;
      const applications = await this.getApplicationsUseCase.execute({
        userId,
        stages: query.stage ? query.stage.split(",") : undefined,
        priority: query.priority,
        pinned: query.pinned ? query.pinned === "true" : undefined,
        followUp:
          query.followUp === "overdue" || query.followUp === "due-soon"
            ? query.followUp
            : undefined,
      });

      res.status(200).json({
        data: applications,
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  create = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("User authentication required");
      }

      const application = await this.createApplicationUseCase.execute({
        ...req.body,
        userId,
      });

      res.status(201).json({
        data: application,
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  updateStatus = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("User authentication required");
      }

      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : String(rawId || "");
      const application = await this.updateApplicationStatusUseCase.execute({
        id,
        userId,
        status: req.body.status,
        note: req.body.note,
      });

      res.status(200).json({
        data: application,
      });
    } catch (err: unknown) {
      next(err);
    }
  };
}

export const applicationController = {
  async getApplications(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const query = req.query as Record<string, string | undefined>;
      const filters: ApplicationFilters = {
        stages: query.stage ? query.stage.split(",") : undefined,
        priority: query.priority,
        pinned: query.pinned ? query.pinned === "true" : undefined,
        followUp:
          query.followUp === "overdue" || query.followUp === "due-soon"
            ? query.followUp
            : undefined,
        stale: query.stale ? query.stale === "true" : undefined,
        staleDays: query.staleDays ? parseInt(query.staleDays, 10) : undefined,
        appliedSinceDays: query.appliedSinceDays ? parseInt(query.appliedSinceDays, 10) : undefined,
        search: query.search,
        archived: query.archived ? query.archived === "true" : false,
        sort:
          (query.sort as "followUp" | "dateAdded" | "lastActivity" | "priority") || "lastActivity",
      };

      const [applications, stats] = await Promise.all([
        applicationRepository.findApplications(userId, filters),
        applicationRepository.getBoardStats(userId),
      ]);

      return res.status(200).json({
        data: {
          applications,
          stats,
          total: applications.length,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async getApplicationById(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const appId = String(req.params.id);
      const application = await applicationRepository.findOwnedById(appId, userId);
      if (!application) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      return res.status(200).json({ data: { application } });
    } catch (err) {
      next(err);
    }
  },

  async createApplication(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
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

      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const { nextFollowUpAt, ...dataWithoutFollowUp } = parsed.data;
      const payload: Partial<ApplicationRecord> = {
        ...dataWithoutFollowUp,
        ...(nextFollowUpAt ? { nextFollowUpAt: new Date(nextFollowUpAt) } : {}),
      };
      const application = await applicationRepository.create({
        ...payload,
        userId,
      });

      if (application.reminderEnabled && application.nextFollowUpAt) {
        try {
          await scheduleApplicationReminder(application);
        } catch (error: unknown) {
          const err = error as Error;
          await applicationRepository.update(application._id, { reminderStatus: "failed" });
          logger.warn(
            { appId: application._id, error: err.message },
            "Application created, but its reminder could not be scheduled",
          );
        }
      }

      await del(CacheKeys.response(userId, "kanban", 1));
      await invalidateCandidateContext(userId);

      return res.status(201).json({ data: { application } });
    } catch (err) {
      next(err);
    }
  },

  async updateApplication(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const parsed = UpdateApplicationSchema.safeParse(req.body);
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

      const { nextFollowUpAt, pinned, pinnedAt, ...dataWithoutFollowUp } = parsed.data;
      const updates: Partial<ApplicationRecord> = {
        ...dataWithoutFollowUp,
        ...(nextFollowUpAt !== undefined
          ? { nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null }
          : {}),
      };
      if (pinnedAt !== undefined) {
        updates.pinnedAt = pinnedAt;
      } else if (pinned !== undefined) {
        updates.pinnedAt = pinned ? new Date() : null;
      }
      const dueAt =
        updates.nextFollowUpAt !== undefined ? updates.nextFollowUpAt : app.nextFollowUpAt;
      const enabled =
        updates.reminderEnabled !== undefined ? updates.reminderEnabled : app.reminderEnabled;
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
        user: user as unknown as Parameters<typeof applicationGraph.handleStageChange>[0]["user"],
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
        user: user as unknown as Parameters<typeof applicationGraph.sendApprovedEmail>[0]["user"],
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

  async archiveApplication(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
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

  async deleteApplication(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
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
