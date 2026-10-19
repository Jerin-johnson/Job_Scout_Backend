import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { interviewGraph } from "../ai/graphs/interviewGraph.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { logger } from "../shared/utils/logger.js";
import { isMongoReady } from "../config/database.js";
import { interviewSessionService } from "../services/interview/sessionService.js";
import { acceptRequestQuota, requestQuotaIdempotencyKey } from "../middleware/quotaGate.js";
import { UserRecord } from "../repositories/userRepository.js";

const PrepSchema = z
  .object({
    jobTitle: z.string().min(1, "jobTitle is required"),
    company: z.string().min(1, "company is required"),
    jdText: z.string().max(12000).optional().default(""),
  })
  .strict();

const MockTurnSchema = z
  .object({
    sessionId: z.string().max(128).optional(),
    questionId: z.string().min(1, "questionId is required").max(128),
    question: z.string().min(1, "question is required").max(1000),
    candidateAnswer: z.string().trim().min(1).max(4000),
  })
  .strict();

const CreateSessionSchema = z
  .object({
    resumeId: z.string().min(1),
    role: z.string().trim().min(1).max(160),
    level: z.enum(["fresher", "mid", "senior"]),
    mode: z.enum(["hr", "founder", "technical", "behavioral", "aptitude_case"]),
    durationMinutes: z.union([z.literal(10), z.literal(20), z.literal(30)]),
    jobDescription: z.string().max(12000).optional().default(""),
    consent: z.object({ accepted: z.literal(true), version: z.string().min(1) }),
  })
  .strict();

const AnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(4000),
    source: z.enum(["text", "audio"]).optional().default("text"),
    audioDurationMs: z
      .number()
      .int()
      .nonnegative()
      .max(30 * 60 * 1000)
      .nullable()
      .optional(),
    startedAtMs: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

const CompleteSchema = z
  .object({ retryFallback: z.boolean().default(false) })
  .strict()
  .default({});
const PinSchema = z.object({ pinned: z.boolean() }).strict();
const EmptySchema = z.object({}).strict().default({});
const SessionQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const StartSchema = z
  .object({ timezone: z.string().trim().min(1).max(64).optional() })
  .strict()
  .default({});

function getUserId(user?: UserRecord): string {
  if (!user) return "";
  return user._id ? user._id.toString() : (user as unknown as { id?: string }).id ? (user as unknown as { id?: string }).id!.toString() : "";
}

export const interviewController = {
  /**
   * POST /api/v1/interview/prep
   * Generates question bank, company overview, and STAR story templates
   */
  async prep(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = PrepSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      }

      const { jobTitle, company, jdText } = parsed.data;
      const user = req.user as UserRecord;
      const userId = getUserId(user);
      const profile = await profileRepository.findByUserId(userId);

      await acceptRequestQuota(req, "interview_prep");

      const prepResult = await interviewGraph.generatePrep({
        user: user as unknown as Parameters<typeof interviewGraph.generatePrep>[0]["user"],
        jobTitle,
        company,
        jdText,
        profile: profile as unknown as Parameters<typeof interviewGraph.generatePrep>[0]["profile"],
      });

      logger.info({ userId, company, jobTitle }, "Interview prep pack generated");

      return res.status(200).json({
        data: prepResult,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/interview/mock/turn
   * Evaluates candidate turn using STAR scoring, capped at 5 turns
   */
  async mockTurn(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = MockTurnSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      }

      const { sessionId, questionId, question, candidateAnswer } = parsed.data;
      const user = req.user as UserRecord;

      await acceptRequestQuota(req, "mock_interview");

      const result = await interviewGraph.runMockTurn({
        user: user as unknown as Parameters<typeof interviewGraph.runMockTurn>[0]["user"],
        sessionId,
        questionId,
        question,
        candidateAnswer,
      });

      return res.status(200).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/interview/:id/report
   * Returns comprehensive scorecard and feedback across mock interview turns
   */
  async getReport(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const { id } = req.params;
      const user = req.user as UserRecord;
      const report = await interviewGraph.getMockSessionReport(String(id), getUserId(user));

      if (!report) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Mock interview session not found",
            requestId: req.id,
          },
        });
      }

      return res.status(200).json({
        data: report,
      });
    } catch (err) {
      next(err);
    }
  },

  modes(_req: Request, res: Response): Response {
    return res.status(200).json({
      data: {
        modes: interviewSessionService.modes,
        consentVersion: interviewSessionService.consentVersion,
        premiumDailyLimit: interviewSessionService.premiumDailyLimit,
        freeTrialEnabled: interviewSessionService.freeTrialEnabled,
        retentionDays: interviewSessionService.retentionDays,
      },
    });
  },

  async createSession(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = CreateSessionSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      if (parsed.data.consent.version !== interviewSessionService.consentVersion)
        return res.status(409).json({
          error: {
            code: "CONSENT_VERSION_MISMATCH",
            message: "Review the current AI processing notice and accept it to continue",
            requestId: req.id,
          },
        });
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "PERSISTENCE_UNAVAILABLE",
            message: "Interview sessions require the database to be available",
            requestId: req.id,
          },
        });
      const session = await interviewSessionService.create(req.user, parsed.data, {
        idempotencyKey: requestQuotaIdempotencyKey(req, "mock_interview"),
      });
      return res.status(201).json({ data: { session } });
    } catch (err) {
      next(err);
    }
  },

  async startSession(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = StartSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      return res.status(200).json({
        data: await interviewSessionService.start(req.user, req.params.id, parsed.data.timezone),
      });
    } catch (err) {
      next(err);
    }
  },

  async answer(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = AnswerSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      const idempotencyKey = String(req.get("Idempotency-Key") || "");
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))
        return res.status(400).json({
          error: {
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Provide an Idempotency-Key header (8-128 safe characters)",
            requestId: req.id,
          },
        });
      return res.status(200).json({
        data: await (
          interviewSessionService.answer as (user: unknown, id: string, data: unknown) => Promise<unknown>
        )(req.user, String(req.params.id), {
          ...parsed.data,
          idempotencyKey,
        }),
      });
    } catch (err) {
      next(err);
    }
  },

  async answerStream(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = AnswerSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      const idempotencyKey = String(req.get("Idempotency-Key") || "");
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))
        return res.status(400).json({
          error: {
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Provide an Idempotency-Key header (8-128 safe characters)",
            requestId: req.id,
          },
        });
      interface AnswerResult {
        nextQuestion?: string;
        [key: string]: unknown;
      }
      const result = (await (
        interviewSessionService.answer as (user: unknown, id: string, data: unknown) => Promise<unknown>
      )(req.user, String(req.params.id), {
        ...parsed.data,
        idempotencyKey,
      })) as AnswerResult;
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
      const question = result.nextQuestion || "";
      for (const token of question.match(/.{1,24}/gu) || []) {
        if (res.destroyed) return;
        res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`);
      }
      if (!res.destroyed) {
        res.write(`event: done\ndata: ${JSON.stringify({ result })}\n\n`);
        res.end();
      }
    } catch (err) {
      next(err);
    }
  },

  async completeSession(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = CompleteSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      return res.status(200).json({
        data: {
          report: await interviewSessionService.complete(req.user, req.params.id, parsed.data),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async listSessions(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = SessionQuerySchema.safeParse(req.query);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      const { page, limit } = parsed.data;
      return res.status(200).json({
        data: {
          sessions: await interviewSessionService.history(req.user, page, limit),
          page,
          limit,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async sessionDetail(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      return res
        .status(200)
        .json({ data: await interviewSessionService.detail(req.user, req.params.id) });
    } catch (err) {
      next(err);
    }
  },

  async sessionReport(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const report = (await interviewSessionService.report(req.user, req.params.id)) as Record<
        string,
        unknown
      > | null;
      if (!report)
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Interview report not found", requestId: req.id },
        });
      return res.status(200).json({ data: { report: report.report } });
    } catch (err) {
      next(err);
    }
  },

  async deleteSession(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = EmptySchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Request body must be empty",
            requestId: req.id,
          },
        });
      return res
        .status(200)
        .json({ data: await interviewSessionService.delete(req.user, req.params.id) });
    } catch (err) {
      next(err);
    }
  },

  async pinSession(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const parsed = PinSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      return res.status(200).json({
        data: await interviewSessionService.pin(req.user, req.params.id, parsed.data.pinned),
      });
    } catch (err) {
      next(err);
    }
  },
};
