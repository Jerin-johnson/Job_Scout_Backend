import { z } from "zod";
import { randomUUID } from "node:crypto";
import { applicationRepository } from "../repositories/applicationRepository.js";
import { applicationGraph } from "../ai/graphs/applicationGraph.js";
import { get, set, del, CacheKeys, TTL } from "../shared/cache.js";
import { logger } from "../shared/utils/logger.js";
import {
  scheduleApplicationReminder,
  cancelApplicationReminder,
} from "../services/applicationReminderQueue.js";

const VALID_STATUSES = ["saved", "applied", "screening", "interviewing", "offer", "rejected"];
const optionalDate = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.union([z.coerce.date(), z.null()]),
);

const CreateApplicationSchema = z.object({
  jobId: z.string().min(1).optional(),
  company: z.string().min(1, "company is required"),
  role: z.string().min(1, "role is required"),
  status: z.enum(VALID_STATUSES).optional().default("saved"),
  notes: z.string().optional().default(""),
  jobUrl: z.string().url().optional().or(z.literal("")),
  hrPhone: z.string().max(40).optional().default(""),
  companyEmail: z.string().email().optional().or(z.literal("")),
  nextFollowUpAt: optionalDate.optional(),
  reminderEnabled: z.boolean().optional().default(false),
});

const UpdateApplicationSchema = z.object({
  notes: z.string().max(5000).optional(),
  jobUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  hrPhone: z.string().max(40).optional(),
  companyEmail: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  nextFollowUpAt: optionalDate.optional(),
  reminderEnabled: z.boolean().optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(VALID_STATUSES),
  note: z.string().optional().default(""),
});

function getUserId(user) {
  if (!user) return "";
  return user._id ? user._id.toString() : user.id ? user.id.toString() : "";
}

export const applicationController = {
  /**
   * GET /api/v1/applications
   * Retrieves candidate's Kanban board applications, grouped by status
   */
  async getApplications(req, res, next) {
    try {
      const userId = getUserId(req.user);
      const cacheKey = CacheKeys.response(userId, "kanban", 1);

      // Check cache
      const cached = await get(cacheKey);
      if (cached) {
        return res.status(200).json({ data: { ...cached, fromCache: true } });
      }

      const applications = await applicationRepository.findByUserId(userId);

      // Group into Kanban columns
      const columns = {
        saved: [],
        applied: [],
        screening: [],
        interviewing: [],
        offer: [],
        rejected: [],
      };

      for (const app of applications) {
        const col = columns[app.status] ? app.status : "saved";
        columns[col].push(app);
      }

      const result = {
        total: applications.length,
        columns,
        applications,
      };

      // Cache for 60s
      await set(cacheKey, result, TTL.RESPONSE);

      return res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/applications
   * Track a new application
   */
  async createApplication(req, res, next) {
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

      const userId = getUserId(req.user);
      if (parsed.data.reminderEnabled && !parsed.data.nextFollowUpAt) {
        return res
          .status(400)
          .json({
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
      if (app.reminderEnabled) {
        try {
          await scheduleApplicationReminder(app);
        } catch (error) {
          app = (await applicationRepository.update(app._id, { reminderStatus: "failed" })) || app;
          logger.warn(
            { appId: app._id, error: error.message },
            "Application created, but its reminder could not be scheduled",
          );
        }
      }
      await del(CacheKeys.response(userId, "kanban", 1));

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
  async getApplicationById(req, res, next) {
    try {
      const app = await applicationRepository.findById(req.params.id);
      if (!app) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      const userId = getUserId(req.user);
      if (app.userId.toString() !== userId) {
        return res.status(403).json({
          error: { code: "FORBIDDEN", message: "Not your application", requestId: req.id },
        });
      }
      return res.status(200).json({ data: { application: app } });
    } catch (err) {
      next(err);
    }
  },

  async updateApplication(req, res, next) {
    try {
      const parsed = UpdateApplicationSchema.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({
            error: {
              code: "VALIDATION_ERROR",
              message: parsed.error.issues[0].message,
              requestId: req.id,
            },
          });
      const app = await applicationRepository.findById(req.params.id);
      if (!app)
        return res
          .status(404)
          .json({
            error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
          });
      const userId = getUserId(req.user);
      if (app.userId.toString() !== userId)
        return res
          .status(403)
          .json({
            error: { code: "FORBIDDEN", message: "Not your application", requestId: req.id },
          });
      const updates = { ...parsed.data };
      const enabled = updates.reminderEnabled ?? app.reminderEnabled ?? false;
      const dueAt = Object.hasOwn(updates, "nextFollowUpAt")
        ? updates.nextFollowUpAt
        : app.nextFollowUpAt;
      if (enabled && !dueAt)
        return res
          .status(400)
          .json({
            error: {
              code: "VALIDATION_ERROR",
              message: "A follow-up date is required to schedule a reminder",
              requestId: req.id,
            },
          });
      await cancelApplicationReminder(app);
      updates.reminderStatus = enabled ? "scheduled" : "none";
      updates.reminderSentAt = null;
      const updated = await applicationRepository.update(req.params.id, updates);
      if (enabled) {
        try {
          await scheduleApplicationReminder(updated);
        } catch (error) {
          updated.reminderStatus = "failed";
          updated.reminderSentAt = null;
          await applicationRepository.update(req.params.id, { reminderStatus: "failed" });
          logger.warn(
            { appId: req.params.id, error: error.message },
            "Application saved, but its reminder could not be scheduled",
          );
        }
      }
      await del(CacheKeys.response(userId, "kanban", 1));
      return res.status(200).json({ data: { application: updated } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/v1/applications/:id/status
   * Update application pipeline stage and trigger Graph D
   */
  async updateStatus(req, res, next) {
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

      const app = await applicationRepository.findById(req.params.id);
      if (!app) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      const userId = getUserId(req.user);
      if (app.userId.toString() !== userId) {
        return res.status(403).json({
          error: { code: "FORBIDDEN", message: "Not your application", requestId: req.id },
        });
      }

      const updated = await applicationGraph.handleStageChange({
        application: app,
        user: req.user,
        newStatus: parsed.data.status,
        note: parsed.data.note,
      });
      await del(CacheKeys.response(userId, "kanban", 1));

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
  async approveFollowUp(req, res, next) {
    try {
      const app = await applicationRepository.findById(req.params.id);
      if (!app) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      const userId = getUserId(req.user);
      if (app.userId.toString() !== userId) {
        return res.status(403).json({
          error: { code: "FORBIDDEN", message: "Not your application", requestId: req.id },
        });
      }

      const sent = await applicationGraph.sendApprovedEmail({
        application: app,
        user: req.user,
      });
      await del(CacheKeys.response(userId, "kanban", 1));

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

  /**
   * DELETE /api/v1/applications/:id
   */
  async deleteApplication(req, res, next) {
    try {
      const app = await applicationRepository.findById(req.params.id);
      if (!app) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Application not found", requestId: req.id },
        });
      }
      const userId = getUserId(req.user);
      if (app.userId.toString() !== userId) {
        return res.status(403).json({
          error: { code: "FORBIDDEN", message: "Not your application", requestId: req.id },
        });
      }

      await applicationRepository.delete(req.params.id);
      await del(CacheKeys.response(userId, "kanban", 1));
      return res.status(200).json({
        data: { message: "Application deleted successfully", id: req.params.id },
      });
    } catch (err) {
      next(err);
    }
  },
};
