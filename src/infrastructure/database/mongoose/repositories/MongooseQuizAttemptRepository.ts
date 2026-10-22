import mongoose from "mongoose";
import { QuizAttemptModel } from "../models/QuizAttemptModel.js";

const ownerId = (userId: string) => new mongoose.Types.ObjectId(userId);

export const quizAttemptRepository = {
  create(input: Record<string, unknown>) {
    return QuizAttemptModel.create(input);
  },

  createIfMissing(input: Record<string, unknown>) {
    const userId = String(input.userId || "");
    const quizSessionId = String(input.quizSessionId || "");
    return QuizAttemptModel.findOneAndUpdate(
      { userId: ownerId(userId), quizSessionId },
      { $setOnInsert: input },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  },

  async findQuestion(userId: string, quizSessionId: string, questionId: string) {
    const attempt = await QuizAttemptModel.findOne({
      userId: ownerId(userId),
      quizSessionId,
    }).lean();
    return attempt?.questions.find((question) => question.questionId === questionId) || null;
  },

  async recentQuestionTexts(userId: string, limit = 24): Promise<string[]> {
    const attempts = await QuizAttemptModel.find({ userId: ownerId(userId) })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 30)))
      .select("questions.question")
      .lean();
    return attempts
      .flatMap((attempt) => attempt.questions.map((question) => question.question))
      .slice(0, 80);
  },

  async findForReplay(userId: string, quizSessionId: string) {
    return QuizAttemptModel.findOne({ userId: ownerId(userId), quizSessionId }).lean();
  },

  async recordAnswer(input: {
    userId: string;
    quizSessionId: string;
    questionId: string;
    userAnswer: string;
    selectedOptionIndex?: number;
    evaluation: Record<string, unknown>;
  }) {
    const attempt = await QuizAttemptModel.findOneAndUpdate(
      {
        userId: ownerId(input.userId),
        quizSessionId: input.quizSessionId,
        questions: { $elemMatch: { questionId: input.questionId, evaluation: { $exists: false } } },
      },
      {
        $set: {
          "questions.$.userAnswer": input.userAnswer,
          ...(input.selectedOptionIndex !== undefined
            ? { "questions.$.selectedOptionIndex": input.selectedOptionIndex }
            : {}),
          "questions.$.evaluation": input.evaluation,
        },
        $inc: { correctCount: input.evaluation.isCorrect === true ? 1 : 0 },
      },
      { new: true },
    ).lean();
    if (attempt) return { attempt, saved: true };
    return {
      attempt: await QuizAttemptModel.findOne({
        userId: ownerId(input.userId),
        quizSessionId: input.quizSessionId,
      }).lean(),
      saved: false,
    };
  },

  async completeIfAnswered(userId: string, quizSessionId: string) {
    const attempt = await QuizAttemptModel.findOne({
      userId: ownerId(userId),
      quizSessionId,
    }).lean();
    if (!attempt) return;
    const answeredCount = attempt.questions.filter((item) => item.evaluation).length;
    if (answeredCount === attempt.questionCount) {
      await QuizAttemptModel.updateOne(
        { userId: ownerId(userId), quizSessionId, status: "in_progress" },
        { $set: { status: "completed", completedAt: new Date() } },
      );
    }
  },

  async list(userId: string, page: number, limit: number) {
    const filter = { userId: ownerId(userId) };
    const [items, total] = await Promise.all([
      QuizAttemptModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(
          "quizSessionId stack status questionCount correctCount createdAt completedAt questions.evaluation",
        )
        .lean(),
      QuizAttemptModel.countDocuments(filter),
    ]);
    return {
      attempts: items.map((attempt) => ({
        id: attempt.quizSessionId,
        stack: attempt.stack,
        status: attempt.status,
        questionCount: attempt.questionCount,
        answeredCount: attempt.questions.filter((question) => question.evaluation).length,
        correctCount: attempt.correctCount,
        createdAt: attempt.createdAt,
        completedAt: attempt.completedAt || null,
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  },

  async detail(userId: string, quizSessionId: string) {
    const attempt = await QuizAttemptModel.findOne({
      userId: ownerId(userId),
      quizSessionId,
    }).lean();
    if (!attempt) return null;
    return {
      id: attempt.quizSessionId,
      stack: attempt.stack,
      status: attempt.status,
      questionCount: attempt.questionCount,
      correctCount: attempt.correctCount,
      createdAt: attempt.createdAt,
      completedAt: attempt.completedAt || null,
      questions: attempt.questions
        .filter((item) => item.evaluation)
        .map((item) => ({
          questionId: item.questionId,
          title: item.title,
          question: item.question,
          type: item.type,
          options: item.options,
          correctOptionIndex: item.correctOptionIndex,
          userAnswer: item.userAnswer,
          selectedOptionIndex: item.selectedOptionIndex,
          correctAnswerText: item.correctAnswerText,
          explanation: item.explanation,
          evaluation: item.evaluation,
        })),
    };
  },

  async delete(userId: string, quizSessionId: string) {
    const deleted = await QuizAttemptModel.findOneAndDelete({
      userId: ownerId(userId),
      quizSessionId,
    })
      .select("_id")
      .lean();
    return Boolean(deleted);
  },
};
