/**
 * @fileoverview Interview Prep & Mock Interview Graph (Graph C)
 *
 * Flow:
 *   companyResearch -> roleQuestionBank -> personalizedSTARStories ->
 *   mockInterviewLoop (stateful, scored, max 5 turns) -> feedbackReport
 */

import { invokeLLM } from "../llm.js";
import { z } from "zod";
import { logger } from "../../shared/utils/logger.js";
import { nanoid } from "nanoid";

const InterviewPrepSchema = z.object({
  companyOverview: z.string(),
  cultureInsights: z.array(z.string()),
  questions: z.array(
    z.object({
      id: z.string(),
      category: z.enum(["technical", "behavioral", "situational", "cultural"]),
      question: z.string(),
      context: z.string(),
      recommendedApproach: z.string(),
    }),
  ),
  suggestedStarStories: z.array(
    z.object({
      factId: z.string(),
      situation: z.string(),
      task: z.string(),
      action: z.string(),
      result: z.string(),
    }),
  ),
});

const MockTurnEvaluationSchema = z.object({
  score: z.number().min(0).max(100),
  starScores: z.object({
    situation: z.number().min(0).max(25),
    task: z.number().min(0).max(25),
    action: z.number().min(0).max(25),
    result: z.number().min(0).max(25),
  }),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  feedback: z.string(),
  nextQuestion: z.string().optional().default(""),
});

// In-memory mock sessions for stateful mock interview turns
const mockSessions = new Map();
const MAX_MOCK_TURNS = 5;

export const interviewGraph = {
  /**
   * Generate comprehensive interview preparation pack
   */
  async generatePrep({ user, jobTitle, company, jdText, profile }) {
    const isDev =
      process.env.ANTHROPIC_API_KEY === "dummy_anthropic_key_for_dev" ||
      process.env.NODE_ENV === "test";

    const userId = user._id ? user._id.toString() : user.id;

    if (isDev) {
      logger.info({ userId, company, jobTitle }, "interviewGraph: mock prep pack");
      const facts = profile?.roles?.[0]?.achievements || [];
      const firstFactId = facts[0]?.factId || "ach_mock_1";

      return {
        companyOverview: `${company} is an industry-leading technology enterprise focused on scalable systems and infrastructure.`,
        cultureInsights: [
          "Emphasis on distributed systems architecture and system resilience.",
          "Value high agency, clear communication, and data-driven decisions.",
        ],
        questions: [
          {
            id: `q_${nanoid(6)}`,
            category: "behavioral",
            question: "Describe a complex distributed system failure you diagnosed and resolved.",
            context: "Assesses incident response, observability, and debugging under pressure.",
            recommendedApproach:
              "Structure using STAR: incident timeline, telemetry used, immediate mitigation, and postmortem fixes.",
          },
          {
            id: `q_${nanoid(6)}`,
            category: "technical",
            question:
              "How do you approach cache invalidation and stampede prevention in high-throughput APIs?",
            context: "Assesses caching patterns, mutex locks, and database protection.",
            recommendedApproach:
              "Discuss single-flight locking, probabilistic early expiration (XFetch), and TTL strategies.",
          },
          {
            id: `q_${nanoid(6)}`,
            category: "situational",
            question:
              "How do you resolve architectural disagreements within your engineering team?",
            context: "Evaluates technical leadership and consensus building.",
            recommendedApproach:
              "Highlight RFC documents, benchmark prototypes, and disagree-and-commit culture.",
          },
        ],
        suggestedStarStories: [
          {
            factId: firstFactId,
            situation:
              "High-traffic spikes caused database connection exhaustion during peak hours.",
            task: "Eliminate downtime and protect downstream services without exploding cloud costs.",
            action:
              "Implemented single-flight distributed locking and Redis response caching with compression.",
            result:
              "Reduced database load by 65% and achieved zero outages during next major spike.",
          },
        ],
      };
    }

    const factsSnippet = (profile?.roles || [])
      .map(
        (r) =>
          `Role: ${r.title} at ${r.company}\nAchievements:\n${(r.achievements || [])
            .map((a) => `- [${a.factId}] ${a.bullet || a.description}`)
            .join("\n")}`,
      )
      .join("\n\n");

    const prompt = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are an executive technical interview coach. Prepare an interview preparation package for:
Candidate: ${user.name || "Candidate"}
Target Role: ${jobTitle}
Company: ${company}
Job Description:
${jdText?.slice(0, 3000) || `${jobTitle} at ${company}`}

Candidate Profile Facts:
${factsSnippet || "General Senior Software Engineering experience"}

Return a JSON object conforming to:
- companyOverview: string
- cultureInsights: string[]
- questions: array of { id, category, question, context, recommendedApproach }
- suggestedStarStories: array of { factId, situation, task, action, result } using candidate facts`,
          },
        ],
      },
    ];

    return invokeLLM({
      user,
      tier: "strong",
      feature: "interview_prep",
      prompt,
      schema: InterviewPrepSchema,
      maxTokens: 2000,
    });
  },

  /**
   * Execute stateful mock interview turn (hard-capped at 5 turns)
   */
  async runMockTurn({ user, sessionId, questionId, question, candidateAnswer }) {
    const isDev =
      process.env.ANTHROPIC_API_KEY === "dummy_anthropic_key_for_dev" ||
      process.env.NODE_ENV === "test";

    const userId = user._id ? user._id.toString() : user.id;
    const sid = sessionId || `session_${userId}_${Date.now()}`;

    // Get or initialize session
    let session = mockSessions.get(sid);
    if (session && session.userId !== userId) {
      const error = new Error("Mock interview session not found");
      error.statusCode = 404;
      error.code = "NOT_FOUND";
      throw error;
    }
    if (!session) {
      session = {
        sessionId: sid,
        userId,
        turns: [],
        currentTurn: 0,
      };
      mockSessions.set(sid, session);
    }

    session.currentTurn += 1;
    const turnNumber = session.currentTurn;
    const isLastTurn = turnNumber >= MAX_MOCK_TURNS;

    if (isDev) {
      const evaluation = {
        sessionId: sid,
        turnNumber,
        maxTurns: MAX_MOCK_TURNS,
        isComplete: isLastTurn,
        score: 88,
        starScores: {
          situation: 22,
          task: 21,
          action: 23,
          result: 22,
        },
        strengths: [
          "Clear explanation of technical constraints and tradeoffs.",
          "Specific metrics and quantifiable impact included in results.",
        ],
        improvements: ["Briefly mention cross-functional collaboration with product or DevOps."],
        feedback:
          "Strong answer following the STAR methodology effectively. Excellent depth on architecture choices.",
        nextQuestion: isLastTurn
          ? null
          : "Tell me about a time you had to make an engineering decision with incomplete information.",
      };

      session.turns.push({
        turnNumber,
        questionId,
        question,
        candidateAnswer,
        evaluation,
      });

      return evaluation;
    }

    const prompt = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a strict technical interviewer evaluating a mock interview turn.
Turn Number: ${turnNumber} of ${MAX_MOCK_TURNS}
Question: ${question}
Candidate Answer: ${candidateAnswer}

Evaluate the response strictly using the STAR methodology (Situation, Task, Action, Result).
Return JSON with:
- score: number (0-100)
- starScores: { situation: 0-25, task: 0-25, action: 0-25, result: 0-25 }
- strengths: string[]
- improvements: string[]
- feedback: string
- nextQuestion: string (a relevant follow-up question, or empty string if turn ${turnNumber} is 5)`,
          },
        ],
      },
    ];

    const result = await invokeLLM({
      user,
      tier: "strong",
      feature: "interview_prep",
      prompt,
      schema: MockTurnEvaluationSchema,
      maxTokens: 1200,
    });

    const evaluation = {
      sessionId: sid,
      turnNumber,
      maxTurns: MAX_MOCK_TURNS,
      isComplete: isLastTurn,
      score: result.score,
      starScores: result.starScores,
      strengths: result.strengths,
      improvements: result.improvements,
      feedback: result.feedback,
      nextQuestion: isLastTurn ? null : result.nextQuestion,
    };

    session.turns.push({
      turnNumber,
      questionId,
      question,
      candidateAnswer,
      evaluation,
    });

    return evaluation;
  },

  /**
   * Retrieve aggregate report for a mock interview session
   */
  async getMockSessionReport(sessionId, userId) {
    const session = mockSessions.get(sessionId);
    if (!session || session.userId !== userId?.toString()) return null;

    const scores = session.turns.map((t) => t.evaluation.score);
    const avgScore =
      scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    return {
      sessionId,
      totalTurnsCompleted: session.turns.length,
      averageScore: avgScore,
      turns: session.turns,
      readinessAssessment:
        avgScore >= 80
          ? "Interview Ready — High confidence for senior/staff roles."
          : "Needs Practice — Focus on quantifiable results and structure.",
    };
  },

  deleteMockSessionsByUserId(userId) {
    for (const [sessionId, session] of mockSessions.entries()) {
      if (session.userId === userId.toString()) mockSessions.delete(sessionId);
    }
  },
};
