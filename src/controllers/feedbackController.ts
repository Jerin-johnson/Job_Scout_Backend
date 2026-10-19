import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { UserFeedback } from "../models/UserFeedback.js";

const inputSchema = z
  .object({
    category: z.enum(["general", "bug", "idea"]).default("general"),
    message: z.string().trim().min(10).max(2000),
  })
  .strict();

export const feedbackController = {
  async submit(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const input = inputSchema.parse(req.body);
      const userId = req.user?._id || (req.user as unknown as { id?: string })?.id;
      const record = await UserFeedback.create({ userId, ...input });
      return res.status(201).json({
        data: {
          id: String(record._id),
          createdAt: (record as unknown as { createdAt?: Date }).createdAt,
          message: "Thanks for your feedback.",
        },
      });
    } catch (error) {
      return next(error);
    }
  },
};
