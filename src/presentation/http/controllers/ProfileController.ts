import { Response, NextFunction } from "express";
import { injectable, inject } from "tsyringe";
import { AuthenticatedRequest } from "../types/index.js";
import { GetProfileUseCase } from "../../../application/useCases/profile/GetProfileUseCase.js";
import { UpsertProfileUseCase } from "../../../application/useCases/profile/UpsertProfileUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";

@injectable()
export class ProfileController {
  constructor(
    @inject(TOKENS.GetProfileUseCase)
    private readonly getProfileUseCase: GetProfileUseCase,
    @inject(TOKENS.UpsertProfileUseCase)
    private readonly upsertProfileUseCase: UpsertProfileUseCase,
  ) {}

  getProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("User authentication required");
      }

      const profile = await this.getProfileUseCase.execute({ userId });
      res.status(200).json({
        data: profile,
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  upsertProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("User authentication required");
      }

      const profile = await this.upsertProfileUseCase.execute({
        ...req.body,
        userId,
      });

      res.status(200).json({
        data: profile,
      });
    } catch (err: unknown) {
      next(err);
    }
  };
}
