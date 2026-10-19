import { UserFeedback } from "../infrastructure/database/mongoose/models/UserFeedbackModel.js";
import { FeedbackInput } from "../shared/schemas/feedbackSchemas.js";

export interface FeedbackRecordResult {
  id: string;
  createdAt?: Date;
  message: string;
}

export const feedbackService = {
  async submitFeedback(
    userId: string | undefined,
    input: FeedbackInput,
  ): Promise<FeedbackRecordResult> {
    const record = await UserFeedback.create({ userId, ...input });
    return {
      id: String(record._id),
      createdAt: (record as unknown as { createdAt?: Date }).createdAt,
      message: "Thanks for your feedback.",
    };
  },
};
