import { injectable, inject } from "tsyringe";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { IInterviewSessionUseCase } from "../../../application/interfaces/useCases/interviews/IInterviewSessionUseCase.js";
import { IInterviewSessionRepository } from "../../../domain/repositories/IInterviewSessionRepository.js";
import { appContainer } from "../../../main/container.js";
import { Request, Response } from "express";
import { interviewGraph } from "../../../infrastructure/ai/graphs/interviewGraph.js";
import { profileRepository } from "../../../infrastructure/database/mongoose/repositories/MongooseProfileRepository.js";
import { logger } from "../../../shared/utils/logger.js";
import { isMongoReady } from "../../../infrastructure/database/database.js";
import { interviewSessionService } from "../../../infrastructure/interview/interviewSessionService.js";
import { createRealtimeTranscriptionCredential } from "../../../infrastructure/interview/realtimeTranscriptionService.js";
import { acceptRequestQuota, requestQuotaIdempotencyKey } from "../middleware/quotaGate.js";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse } from "../../../shared/types/apiResponse.js";
import {
  prepSchema,
  mockTurnSchema,
  createSessionSchema,
  answerSchema,
  completeSchema,
  pinSchema,
  emptySchema,
  sessionQuerySchema,
  startSchema,
  quizSessionSchema,
  quizSubmitSchema,
  quizHistoryQuerySchema,
  quizAttemptIdSchema,
  transcriptionSessionSchema,
} from "../../../shared/schemas/interviewSchemas.js";
import { stackQuizService } from "../../../infrastructure/interview/stackQuizService.js";

function getUserId(user?: UserRecord): string {
  if (!user) return "";
  return user._id
    ? user._id.toString()
    : (user as unknown as { id?: string }).id
      ? (user as unknown as { id?: string }).id!.toString()
      : "";
}

@injectable()
export class InterviewController {
  constructor(
    @inject(TOKENS.InterviewSessionUseCase)
    private readonly interviewSessionUseCase: IInterviewSessionUseCase,
    @inject(TOKENS.InterviewSessionRepository)
    private readonly sessionRepo: IInterviewSessionRepository,
  ) {}

  createTranscriptionSession = asyncHandler(async (req: Request, res: Response) => {
    transcriptionSessionSchema.parse(req.body);
    const user = req.user as UserRecord;
    const sessionId = String(req.params.id || "");
    if (!sessionId || sessionId.length > 128) {
      return res.status(400).json({
        error: {
          code: "INVALID_SESSION_ID",
          message: "Choose a valid interview session",
          requestId: req.id,
        },
      });
    }
    await interviewSessionService.assertTranscriptionAllowed(user, sessionId);
    const userId = getUserId(user);
    const credential = await createRealtimeTranscriptionCredential(userId);
    res.setHeader("Cache-Control", "no-store, private");
    return res.status(200).json(successResponse(credential));
  });

  /**
   * POST /api/v1/interview/prep
   * Generates question bank, company overview, and STAR story templates
   */
  prep = asyncHandler(async (req: Request, res: Response) => {
    const { jobTitle, company, jdText } = prepSchema.parse(req.body);
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

    return res.status(200).json(successResponse(prepResult));
  });

  /**
   * POST /api/v1/interview/mock/turn
   * Evaluates candidate turn using STAR scoring, capped at 5 turns
   */
  mockTurn = asyncHandler(async (req: Request, res: Response) => {
    const { sessionId, questionId, question, candidateAnswer } = mockTurnSchema.parse(req.body);
    const user = req.user as UserRecord;

    await acceptRequestQuota(req, "mock_interview");

    const result = await interviewGraph.runMockTurn({
      user: user as unknown as Parameters<typeof interviewGraph.runMockTurn>[0]["user"],
      sessionId,
      questionId,
      question,
      candidateAnswer,
    });

    return res.status(200).json(successResponse(result));
  });

  /**
   * GET /api/v1/interview/:id/report
   * Returns comprehensive scorecard and feedback across mock interview turns
   */
  getReport = asyncHandler(async (req: Request, res: Response) => {
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

    return res.status(200).json(successResponse(report));
  });

  modes = (_req: Request, res: Response): Response => {
    return res.status(200).json(
      successResponse({
        modes: interviewSessionService.modes,
        consentVersion: interviewSessionService.consentVersion,
        premiumDailyLimit: interviewSessionService.premiumDailyLimit,
        freeTrialEnabled: interviewSessionService.freeTrialEnabled,
        retentionDays: interviewSessionService.retentionDays,
      }),
    );
  };

  createSession = asyncHandler(async (req: Request, res: Response) => {
    const data = createSessionSchema.parse(req.body);
    if (data.consent.version !== interviewSessionService.consentVersion) {
      return res.status(409).json({
        error: {
          code: "CONSENT_VERSION_MISMATCH",
          message: "Review the current AI processing notice and accept it to continue",
          requestId: req.id,
        },
      });
    }
    if (!isMongoReady()) {
      return res.status(503).json({
        error: {
          code: "PERSISTENCE_UNAVAILABLE",
          message: "Interview sessions require the database to be available",
          requestId: req.id,
        },
      });
    }
    const session = await interviewSessionService.create(req.user, data, {
      idempotencyKey: requestQuotaIdempotencyKey(req, "mock_interview"),
    });
    return res.status(201).json(successResponse({ session }));
  });

  startSession = asyncHandler(async (req: Request, res: Response) => {
    const { timezone } = startSchema.parse(req.body);
    const session = await interviewSessionService.start(req.user, String(req.params.id), timezone);
    return res.status(200).json(successResponse(session));
  });

  answer = asyncHandler(async (req: Request, res: Response) => {
    const parsedData = answerSchema.parse(req.body);
    const idempotencyKey = String(req.get("Idempotency-Key") || "");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return res.status(400).json({
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Provide an Idempotency-Key header (8-128 safe characters)",
          requestId: req.id,
        },
      });
    }
    const result = await (
      interviewSessionService.answer as (
        user: unknown,
        id: string,
        data: unknown,
      ) => Promise<unknown>
    )(req.user, String(req.params.id), {
      ...parsedData,
      idempotencyKey,
    });
    return res.status(200).json(successResponse(result));
  });

  answerStream = asyncHandler(async (req: Request, res: Response) => {
    const parsedData = answerSchema.parse(req.body);
    const idempotencyKey = String(req.get("Idempotency-Key") || "");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return res.status(400).json({
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Provide an Idempotency-Key header (8-128 safe characters)",
          requestId: req.id,
        },
      });
    }
    interface AnswerResult {
      nextQuestion?: string;
      [key: string]: unknown;
    }
    const result = (await (
      interviewSessionService.answer as (
        user: unknown,
        id: string,
        data: unknown,
      ) => Promise<unknown>
    )(req.user, String(req.params.id), {
      ...parsedData,
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
    return;
  });

  completeSession = asyncHandler(async (req: Request, res: Response) => {
    const parsedData = completeSchema.parse(req.body);
    const report = await interviewSessionService.complete(
      req.user,
      String(req.params.id),
      parsedData,
    );
    return res.status(200).json(successResponse({ report }));
  });

  listSessions = asyncHandler(async (req: Request, res: Response) => {
    const { page, limit } = sessionQuerySchema.parse(req.query);
    const sessions = await interviewSessionService.history(req.user, page, limit);
    return res.status(200).json(successResponse({ sessions, page, limit }));
  });

  sessionDetail = asyncHandler(async (req: Request, res: Response) => {
    const detail = await interviewSessionService.detail(req.user, String(req.params.id));
    return res.status(200).json(successResponse(detail));
  });

  sessionReport = asyncHandler(async (req: Request, res: Response) => {
    const report = (await interviewSessionService.report(
      req.user,
      String(req.params.id),
    )) as Record<string, unknown> | null;
    if (!report) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Interview report not found", requestId: req.id },
      });
    }
    return res.status(200).json(successResponse({ report: report.report }));
  });

  deleteSession = asyncHandler(async (req: Request, res: Response) => {
    emptySchema.parse(req.body);
    const result = await interviewSessionService.delete(req.user, String(req.params.id));
    return res.status(200).json(successResponse(result));
  });

  pinSession = asyncHandler(async (req: Request, res: Response) => {
    const { pinned } = pinSchema.parse(req.body);
    const result = await interviewSessionService.pin(req.user, String(req.params.id), pinned);
    return res.status(200).json(successResponse(result));
  });

  /**
   * GET /api/v1/interview/quiz/question
   */
  getQuizQuestion = asyncHandler(async (req: Request, res: Response) => {
    return res.status(410).json({
      error: {
        code: "QUIZ_SESSION_REQUIRED",
        message: "Start a personalized quiz session to receive questions.",
        requestId: req.id,
      },
    });
  });

  startQuizSession = asyncHandler(async (req: Request, res: Response) => {
    if (!isMongoReady()) {
      return res.status(503).json({
        error: {
          code: "PERSISTENCE_UNAVAILABLE",
          message: "Quiz history is temporarily unavailable",
          requestId: req.id,
        },
      });
    }
    const body = quizSessionSchema.parse(req.body);
    const user = req.user as UserRecord;
    const result = await stackQuizService.startQuizSession({
      userId: getUserId(user),
      user: user as unknown as Parameters<typeof stackQuizService.startQuizSession>[0]["user"],
      resumeId: body.resumeId,
      focus: body.focus,
    });
    return res.status(200).json(successResponse(result));
  });

  /**
   * POST /api/v1/interview/quiz/submit
   */
  submitQuizAnswer = asyncHandler(async (req: Request, res: Response) => {
    const body = quizSubmitSchema.parse(req.body);
    const user = req.user as UserRecord;
    const userId = getUserId(user);

    const result = await stackQuizService.submitAnswer({
      userId,
      user,
      quizSessionId: body.quizSessionId,
      questionId: body.questionId,
      stack: body.stack,
      userAnswer: body.userAnswer,
      selectedOptionIndex: body.selectedOptionIndex,
      audioTranscript: body.audioTranscript,
    });

    return res.status(200).json(successResponse(result));
  });

  /**
   * GET /api/v1/interview/quiz/stats
   */
  getQuizStats = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);

    const stats = await stackQuizService.getStatsForUser(userId);
    return res.status(200).json(successResponse(stats));
  });

  listQuizHistory = asyncHandler(async (req: Request, res: Response) => {
    if (!isMongoReady()) {
      return res.status(503).json({
        error: {
          code: "PERSISTENCE_UNAVAILABLE",
          message: "Quiz history is temporarily unavailable",
          requestId: req.id,
        },
      });
    }
    const { page, limit } = quizHistoryQuerySchema.parse(req.query);
    const result = await stackQuizService.listAttempts(
      getUserId(req.user as UserRecord),
      page,
      limit,
    );
    return res.status(200).json(successResponse(result));
  });

  getQuizHistoryDetail = asyncHandler(async (req: Request, res: Response) => {
    if (!isMongoReady()) {
      return res.status(503).json({
        error: {
          code: "PERSISTENCE_UNAVAILABLE",
          message: "Quiz history is temporarily unavailable",
          requestId: req.id,
        },
      });
    }
    const quizSessionId = quizAttemptIdSchema.parse(req.params.id);
    const result = await stackQuizService.getAttemptDetail(
      getUserId(req.user as UserRecord),
      quizSessionId,
    );
    if (!result) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Quiz attempt not found", requestId: req.id },
      });
    }
    return res.status(200).json(successResponse(result));
  });

  repracticeQuizHistory = asyncHandler(async (req: Request, res: Response) => {
    if (!isMongoReady()) {
      return res.status(503).json({
        error: {
          code: "PERSISTENCE_UNAVAILABLE",
          message: "Quiz history is temporarily unavailable",
          requestId: req.id,
        },
      });
    }
    const quizSessionId = quizAttemptIdSchema.parse(req.params.id);
    const session = await stackQuizService.repracticeAttempt(
      getUserId(req.user as UserRecord),
      quizSessionId,
    );
    return res.status(201).json(successResponse(session));
  });

  deleteQuizHistory = asyncHandler(async (req: Request, res: Response) => {
    if (!isMongoReady()) {
      return res.status(503).json({
        error: {
          code: "PERSISTENCE_UNAVAILABLE",
          message: "Quiz history is temporarily unavailable",
          requestId: req.id,
        },
      });
    }
    const quizSessionId = quizAttemptIdSchema.parse(req.params.id);
    const deleted = await stackQuizService.deleteAttempt(
      getUserId(req.user as UserRecord),
      quizSessionId,
    );
    if (!deleted) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Quiz attempt not found", requestId: req.id },
      });
    }
    return res.status(200).json(successResponse({ deleted: true }));
  });
}

export const interviewController = new Proxy({} as InterviewController, {
  get(_target, prop) {
    const instance = appContainer.resolve(InterviewController);
    const value = (instance as unknown as Record<string, unknown>)[prop as string];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(instance)
      : value;
  },
});
