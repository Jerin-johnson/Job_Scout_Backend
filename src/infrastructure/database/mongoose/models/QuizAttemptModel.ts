import mongoose, { Document, Model, Schema } from "mongoose";

export interface IQuizAttemptQuestion {
  questionId: string;
  title: string;
  question: string;
  type: "quick_mcq" | "scenario_voice";
  options: string[];
  correctOptionIndex?: number;
  userAnswer: string;
  selectedOptionIndex?: number;
  correctAnswerText: string;
  explanation: string;
  expectedKeyPoints?: string[];
  pointsReward?: number;
  difficulty?: "junior" | "mid" | "senior";
  voicePromptText?: string;
  evaluation?: Record<string, unknown>;
}

export interface IQuizAttemptDocument extends Document {
  userId: mongoose.Types.ObjectId;
  quizSessionId: string;
  stack: string;
  promptVersion: string;
  status: "in_progress" | "completed";
  questions: IQuizAttemptQuestion[];
  focusLabel?: string;
  questionCount: number;
  correctCount: number;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QuizAttemptQuestionSchema = new Schema<IQuizAttemptQuestion>(
  {
    questionId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 100 },
    question: { type: String, required: true, maxlength: 500 },
    type: { type: String, enum: ["quick_mcq", "scenario_voice"], required: true },
    options: { type: [String], default: [] },
    correctOptionIndex: { type: Number, min: 0, max: 3 },
    userAnswer: { type: String, default: "", maxlength: 4000 },
    selectedOptionIndex: { type: Number, min: 0, max: 3 },
    correctAnswerText: { type: String, default: "", maxlength: 700 },
    explanation: { type: String, required: true, maxlength: 500 },
    expectedKeyPoints: { type: [String], default: undefined },
    pointsReward: { type: Number, min: 0, max: 100, default: undefined },
    difficulty: { type: String, enum: ["junior", "mid", "senior"], default: undefined },
    voicePromptText: { type: String, maxlength: 700, default: undefined },
    evaluation: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

const QuizAttemptSchema = new Schema<IQuizAttemptDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    quizSessionId: { type: String, required: true, maxlength: 128 },
    stack: { type: String, required: true, maxlength: 64 },
    promptVersion: { type: String, required: true, maxlength: 64 },
    focusLabel: { type: String, maxlength: 180, default: "" },
    status: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "in_progress",
      required: true,
    },
    questions: {
      type: [QuizAttemptQuestionSchema],
      required: true,
      validate: [
        (value: unknown[]) => value.length >= 3 && value.length <= 5,
        "Quiz must have three to five questions",
      ],
    },
    questionCount: { type: Number, required: true, min: 3, max: 5 },
    correctCount: { type: Number, default: 0, min: 0, max: 5 },
    completedAt: { type: Date, default: undefined },
  },
  { timestamps: true, minimize: false },
);

QuizAttemptSchema.index(
  { userId: 1, quizSessionId: 1 },
  { unique: true, name: "quiz_attempt_user_session_unique" },
);
QuizAttemptSchema.index({ userId: 1, createdAt: -1 }, { name: "quiz_attempt_user_created_idx" });

export const QuizAttemptModel: Model<IQuizAttemptDocument> =
  (mongoose.models.QuizAttempt as Model<IQuizAttemptDocument>) ||
  mongoose.model<IQuizAttemptDocument>("QuizAttempt", QuizAttemptSchema);
