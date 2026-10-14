import { z } from "zod";
import { interviewGraph } from "../ai/graphs/interviewGraph.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { logger } from "../shared/utils/logger.js";

const PrepSchema = z.object({
  jobTitle: z.string().min(1, "jobTitle is required"),
  company: z.string().min(1, "company is required"),
  jdText: z.string().optional().default(""),
});

const MockTurnSchema = z.object({
  sessionId: z.string().optional(),
  questionId: z.string().min(1, "questionId is required"),
  question: z.string().min(1, "question is required"),
  candidateAnswer: z.string().min(10, "candidateAnswer must be at least 10 characters"),
});

function getUserId(user) {
  if (!user) return "";
  return user._id ? user._id.toString() : user.id ? user.id.toString() : "";
}

export const interviewController = {
  /**
   * POST /api/v1/interview/prep
   * Generates question bank, company overview, and STAR story templates
   */
  async prep(req, res, next) {
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
      const userId = getUserId(req.user);
      const profile = await profileRepository.findByUserId(userId);

      const prepResult = await interviewGraph.generatePrep({
        user: req.user,
        jobTitle,
        company,
        jdText,
        profile,
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
  async mockTurn(req, res, next) {
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

      const result = await interviewGraph.runMockTurn({
        user: req.user,
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
  async getReport(req, res, next) {
    try {
      const { id } = req.params;
      const report = await interviewGraph.getMockSessionReport(id);

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
};
