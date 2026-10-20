import { injectable, inject } from "tsyringe";
import { IUseCase } from "../IUseCase.js";
import {
  UpdateApplicationStatusInputDTO,
  ApplicationOutputDTO,
  updateApplicationStatusSchema,
} from "../../dtos/applicationDtos.js";
import { IApplicationRepository } from "../../../domain/repositories/IApplicationRepository.js";
import { NotFoundError, ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class UpdateApplicationStatusUseCase
  implements IUseCase<UpdateApplicationStatusInputDTO, ApplicationOutputDTO>
{
  constructor(
    @inject(TOKENS.ApplicationRepository)
    private readonly applicationRepository: IApplicationRepository,
  ) {}

  async execute(input: UpdateApplicationStatusInputDTO): Promise<ApplicationOutputDTO> {
    const parseResult = updateApplicationStatusSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid update status details", parseResult.error.issues);
    }
    const { id, userId, status, note } = parseResult.data;

    const existing = await this.applicationRepository.findOwnedById(id, userId);
    if (!existing) {
      throw new NotFoundError("Application not found or unauthorized");
    }

    const updatedLog = [
      ...existing.activityLog,
      {
        action: status,
        notes: note || `Status changed to ${status}`,
        date: new Date(),
      },
    ];

    const updated = await this.applicationRepository.update(id, {
      status,
      activityLog: updatedLog,
      lastActivityAt: new Date(),
    });

    if (!updated) {
      throw new NotFoundError("Failed to update application status");
    }

    return {
      id: updated.id,
      userId: updated.userId,
      jobId: updated.jobId ?? null,
      companyName: updated.companyName,
      jobTitle: updated.jobTitle,
      status: updated.status,
      priority: updated.priority,
      appliedDate: updated.appliedDate,
      location: updated.location,
      source: updated.source,
      notes: updated.notes,
      pinnedAt: updated.pinnedAt,
      archivedAt: updated.archivedAt,
      nextFollowUpAt: updated.nextFollowUpAt,
      lastActivityAt: updated.lastActivityAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
