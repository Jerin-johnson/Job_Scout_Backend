import { z } from "zod";
import { applicationRepository } from "../repositories/applicationRepository.js";
import { applicationGraph } from "../ai/graphs/applicationGraph.js";
import { get, set, CacheKeys, TTL } from "../shared/cache.js";
import { logger } from "../shared/utils/logger.js";

const VALID_STATUSES = [
  "saved",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
];

const CreateApplicationSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
  company: z.string().min(1, "company is required"),
  role: z.string().min(1, "role is required"),
  status: z.enum(VALID_STATUSES).optional().default("saved"),
  notes: z.string().optional().default(""),
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
      const app = await applicationRepository.create({
        ...parsed.data,
        userId,
      });

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
      return res.status(200).json({
        data: { message: "Application deleted successfully", id: req.params.id },
      });
    } catch (err) {
      next(err);
    }
  },
};
