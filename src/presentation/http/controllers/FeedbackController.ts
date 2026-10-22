import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { ISubmitFeedbackUseCase } from "../../../application/interfaces/useCases/feedback/ISubmitFeedbackUseCase.js";
import { feedbackInputSchema } from "../../../shared/schemas/feedbackSchemas.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse } from "../../../shared/types/apiResponse.js";
import { appContainer } from "../../../main/container.js";

@injectable()
export class FeedbackController {
  constructor(
    @inject(TOKENS.SubmitFeedbackUseCase)
    private readonly submitFeedbackUseCase: ISubmitFeedbackUseCase,
  ) {}

  submit = asyncHandler(async (req: Request, res: Response) => {
    const input = feedbackInputSchema.parse(req.body);
    const userId = req.user?._id
      ? String(req.user._id)
      : (req.user as unknown as { id?: string })?.id;
    const result = await this.submitFeedbackUseCase.execute({
      userId,
      ...input,
    });
    return res.status(201).json(successResponse(result));
  });
}

export const feedbackController = new Proxy({} as FeedbackController, {
  get(_target, prop) {
    const instance = appContainer.resolve(FeedbackController);
    const value = (instance as unknown as Record<string, unknown>)[prop as string];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(instance)
      : value;
  },
});
