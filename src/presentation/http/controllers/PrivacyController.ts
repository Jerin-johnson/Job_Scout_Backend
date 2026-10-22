import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { IExportUserDataUseCase } from "../../../application/interfaces/useCases/privacy/IExportUserDataUseCase.js";
import { IDeleteUserAccountUseCase } from "../../../application/interfaces/useCases/privacy/IDeleteUserAccountUseCase.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse } from "../../../shared/types/apiResponse.js";
import { appContainer } from "../../../main/container.js";

function getUserId(user?: unknown): string {
  if (!user || typeof user !== "object") return "";
  const u = user as Record<string, unknown>;
  return String(u._id || u.id || u.userId || "");
}

@injectable()
export class PrivacyController {
  constructor(
    @inject(TOKENS.ExportUserDataUseCase)
    private readonly exportUserDataUseCase: IExportUserDataUseCase,
    @inject(TOKENS.DeleteUserAccountUseCase)
    private readonly deleteUserAccountUseCase: IDeleteUserAccountUseCase,
  ) {}

  /**
   * GET /api/v1/privacy/export
   * Exports full candidate data portfolio as JSON (GDPR / India DPDP Article 12)
   */
  exportData = asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req.user);

    const exportBundle = await this.exportUserDataUseCase.execute(userId);

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="jobscout_data_export_${userId}.json"`,
    );

    return res.status(200).json(successResponse(exportBundle));
  });

  /**
   * DELETE /api/v1/privacy/delete-account
   * Right-to-be-forgotten endpoint: soft deletes user, purges memories, revokes tokens
   */
  deleteAccount = asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req.user);

    const result = await this.deleteUserAccountUseCase.execute(userId);

    return res.status(200).json(successResponse(result));
  });
}

export const privacyController = new Proxy({} as PrivacyController, {
  get(_target, prop) {
    const instance = appContainer.resolve(PrivacyController);
    const value = (instance as unknown as Record<string, unknown>)[prop as string];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(instance)
      : value;
  },
});
