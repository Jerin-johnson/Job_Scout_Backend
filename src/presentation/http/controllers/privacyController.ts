import { Request, Response } from "express";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { privacyService } from "../../../infrastructure/database/mongoose/services/privacyService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse } from "../../../shared/types/apiResponse.js";

function getUserId(user?: UserRecord): string {
  if (!user) return "";
  return user._id
    ? user._id.toString()
    : (user as unknown as { id?: string }).id
      ? (user as unknown as { id?: string }).id!.toString()
      : "";
}

export const privacyController = {
  /**
   * GET /api/v1/privacy/export
   * Exports full candidate data portfolio as JSON (GDPR / India DPDP Article 12)
   */
  exportData: asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);

    const exportBundle = await privacyService.exportUserData(user, userId);

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="jobscout_data_export_${userId}.json"`,
    );

    return res.status(200).json(successResponse(exportBundle));
  }),

  /**
   * DELETE /api/v1/privacy/delete-account
   * Right-to-be-forgotten endpoint: soft deletes user, purges memories, revokes tokens
   */
  deleteAccount: asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);

    const result = await privacyService.deleteUserAccount(userId);

    return res.status(200).json(successResponse(result));
  }),
};
