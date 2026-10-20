import { injectable } from "tsyringe";
import {
  IFeedbackRepository,
  FeedbackRecordResult,
} from "../../../../domain/repositories/IFeedbackRepository.js";
import { UserFeedback } from "../models/UserFeedbackModel.js";

@injectable()
export class MongooseFeedbackRepository implements IFeedbackRepository {
  async createFeedback(
    userId: string | undefined,
    input: Record<string, unknown>,
  ): Promise<FeedbackRecordResult> {
    const record = await UserFeedback.create({ userId, ...input });
    return {
      id: String(record._id),
      createdAt: (record as unknown as { createdAt?: Date }).createdAt,
      message: "Thanks for your feedback.",
    };
  }

  async submitFeedback(
    userId: string | undefined,
    input: Record<string, unknown>,
  ): Promise<FeedbackRecordResult> {
    return this.createFeedback(userId, input);
  }
}

export const feedbackRepository = new MongooseFeedbackRepository();
export const feedbackService = feedbackRepository;
