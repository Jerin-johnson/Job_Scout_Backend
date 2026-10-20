import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { AuthenticatedRequest } from "../types/index.js";
import { GetApplicationsUseCase } from "../../../application/useCases/applications/GetApplicationsUseCase.js";
import { CreateApplicationUseCase } from "../../../application/useCases/applications/CreateApplicationUseCase.js";
import { UpdateApplicationStatusUseCase } from "../../../application/useCases/applications/UpdateApplicationStatusUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";
import { applicationGraph } from "../../../infrastructure/ai/graphs/applicationGraph.js";
import {
  applicationRepository,
  ApplicationRecord,
  ApplicationFilters,
} from "../../../infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js";
import { applicationReminderTransition } from "../../../domain/services/applications/applicationLifecycle.js";
import {
  scheduleApplicationReminder,
  cancelApplicationReminder,
} from "../../../infrastructure/queue/applicationReminderQueue.js";
import { logger } from "../../../shared/utils/logger.js";
import { del, CacheKeys } from "../../../shared/cache.js";
import { invalidateCandidateContext } from "../../../infrastructure/ai/candidateContext.js";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse, errorResponse } from "../../../shared/types/apiResponse.js";
import {
  createApplicationSchema,
  updateApplicationSchema,
  updateApplicationStatusSchema,
  archiveApplicationSchema,
} from "../../../shared/schemas/applicationSchemas.js";

function getUserId(user?: unknown): string {
  if (!user || typeof user !== "object") throw new UnauthorizedError("User identification missing");
  const u = user as Record<string, unknown>;
  if (u.userId) return String(u.userId);
  if (u._id) return String(u._id);
  if (u.id) return String(u.id);
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

  list = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
        query.followUp === "overdue" || query.followUp === "due-soon" ? query.followUp : undefined,
    });

    res.status(200).json(successResponse(applications));
  });

  create = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedError("User authentication required");
    }

    const application = await this.createApplicationUseCase.execute({
      ...req.body,
      userId,
    });

    res.status(201).json(successResponse(application));
  });

  updateStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

    res.status(200).json(successResponse(application));
  });
}

export const applicationController = {
  getApplications: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const query = req.query as Record<string, string | undefined>;
    const filters: ApplicationFilters = {
      stages: query.stage ? query.stage.split(",") : undefined,
      priority: query.priority,
      pinned: query.pinned ? query.pinned === "true" : undefined,
      followUp:
        query.followUp === "overdue" || query.followUp === "due-soon" ? query.followUp : undefined,
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

    res.status(200).json(
      successResponse({
        applications,
        stats,
        total: applications.length,
      }),
    );
  }),

  getApplicationById: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const appId = String(req.params.id);
    const application = await applicationRepository.findOwnedById(appId, userId);
    if (!application) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", "Application not found", req.id ? String(req.id) : undefined),
        );
      return;
    }
    res.status(200).json(successResponse({ application }));
  }),

  createApplication: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = createApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            parsed.error.issues[0].message,
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
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

    res.status(201).json(successResponse({ application }));
  }),

  updateApplication: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = updateApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            parsed.error.issues[0].message,
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }

    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const appId = String(req.params.id);
    const app = await applicationRepository.findOwnedById(appId, userId);
    if (!app) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", "Application not found", req.id ? String(req.id) : undefined),
        );
      return;
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
    if (enabled && !dueAt) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            "A follow-up date is required to schedule a reminder",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
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
    res.status(200).json(successResponse({ application: updated }));
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = updateApplicationStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            parsed.error.issues[0].message,
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }

    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const appId = String(req.params.id);
    const app = await applicationRepository.findOwnedById(appId, userId);
    if (!app) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", "Application not found", req.id ? String(req.id) : undefined),
        );
      return;
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
            (await applicationRepository.update(app._id, { reminderStatus: "failed" })) || updated;
          logger.warn(
            { appId: app._id, error: err.message },
            "Updated follow-up reminder could not be scheduled",
          );
        }
      }
    }
    await del(CacheKeys.response(userId, "kanban", 1));
    await invalidateCandidateContext(userId);

    res.status(200).json(
      successResponse({
        message: `Application moved to ${parsed.data.status}`,
        application: updated,
      }),
    );
  }),

  approveFollowUp: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const appId = String(req.params.id);
    const app = await applicationRepository.findOwnedById(appId, userId);
    if (!app) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", "Application not found", req.id ? String(req.id) : undefined),
        );
      return;
    }
    const sent = await applicationGraph.sendApprovedEmail({
      application: app,
      user: user as unknown as Parameters<typeof applicationGraph.sendApprovedEmail>[0]["user"],
    });
    await del(CacheKeys.response(userId, "kanban", 1));
    await invalidateCandidateContext(userId);

    res.status(200).json(
      successResponse({
        message: "Follow-up email approved and dispatched successfully",
        application: sent,
      }),
    );
  }),

  archiveApplication: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = archiveApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            parsed.error.issues[0].message,
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const appId = String(req.params.id);
    const app = await applicationRepository.findOwnedById(appId, userId);
    if (!app) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", "Application not found", req.id ? String(req.id) : undefined),
        );
      return;
    }
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
    res.status(200).json(successResponse({ application: updated }));
  }),

  deleteApplication: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const appId = String(req.params.id);
    const app = await applicationRepository.findOwnedById(appId, userId);
    if (!app) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", "Application not found", req.id ? String(req.id) : undefined),
        );
      return;
    }
    await applicationRepository.delete(appId);
    await cancelApplicationReminder(app);
    await del(CacheKeys.response(userId, "kanban", 1));
    await invalidateCandidateContext(userId);
    res.status(200).json(
      successResponse({
        message: "Application deleted successfully",
        id: appId,
      }),
    );
  }),
};
