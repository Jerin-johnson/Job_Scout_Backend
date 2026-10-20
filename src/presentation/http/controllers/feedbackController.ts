import { Request, Response } from "express";
import { feedbackInputSchema } from "../../../shared/schemas/feedbackSchemas.js";
import { feedbackService } from "../../../services/feedbackService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse } from "../../../shared/types/apiResponse.js";

export const feedbackController = {
  submit: asyncHandler(async (req: Request, res: Response) => {
    const input = feedbackInputSchema.parse(req.body);
    const userId = req.user?._id
      ? String(req.user._id)
      : (req.user as unknown as { id?: string })?.id;
    const result = await feedbackService.submitFeedback(userId, input);
    return res.status(201).json(successResponse(result));
  }),
};
