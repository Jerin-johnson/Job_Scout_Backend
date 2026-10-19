import { Response, NextFunction } from "express";
import { injectable, inject } from "tsyringe";
import { AuthenticatedRequest } from "../types/index.js";
import { GetApplicationsUseCase } from "../../../application/useCases/applications/GetApplicationsUseCase.js";
import { CreateApplicationUseCase } from "../../../application/useCases/applications/CreateApplicationUseCase.js";
import { UpdateApplicationStatusUseCase } from "../../../application/useCases/applications/UpdateApplicationStatusUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";

@injectable()
export class ApplicationController {
  constructor(
    @inject(TOKENS.GetApplicationsUseCase)
    private readonly getApplicationsUseCase: GetApplicationsUseCase,
    @inject(TOKENS.CreateApplicationUseCase)
    private readonly createApplicationUseCase: CreateApplicationUseCase,
    @inject(TOKENS.UpdateApplicationStatusUseCase)
    private readonly updateApplicationStatusUseCase: UpdateApplicationStatusUseCase,
  ) {}

  list = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("User authentication required");
      }

      const query = req.query as Record<string, string | undefined>;
      const applications = await this.getApplicationsUseCase.execute({
        userId,
        stages: query.stage ? query.stage.split(",") : undefined,
        priority: query.priority,
        pinned: query.pinned ? query.pinned === "true" : undefined,
        followUp: query.followUp === "overdue" || query.followUp === "due-soon" ? query.followUp : undefined,
      });

      res.status(200).json({
        data: applications,
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  create = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("User authentication required");
      }

      const application = await this.createApplicationUseCase.execute({
        ...req.body,
        userId,
      });

      res.status(201).json({
        data: application,
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  updateStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("User authentication required");
      }

      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : String(rawId || "");
      const application = await this.updateApplicationStatusUseCase.execute({
        id,
        userId,
        status: req.body.status,
        note: req.body.note,
      });

      res.status(200).json({
        data: application,
      });
    } catch (err: unknown) {
      next(err);
    }
  };
}
