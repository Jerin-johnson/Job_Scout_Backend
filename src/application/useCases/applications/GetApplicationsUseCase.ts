import { injectable, inject } from "tsyringe";
import { IUseCase } from "../IUseCase.js";
import { GetApplicationsInputDTO, ApplicationOutputDTO } from "../../dtos/applicationDtos.js";
import { IApplicationRepository } from "../../../domain/repositories/IApplicationRepository.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class GetApplicationsUseCase
  implements IUseCase<GetApplicationsInputDTO, ApplicationOutputDTO[]>
{
  constructor(
    @inject(TOKENS.ApplicationRepository)
    private readonly applicationRepository: IApplicationRepository,
  ) {}

  async execute(input: GetApplicationsInputDTO): Promise<ApplicationOutputDTO[]> {
    const applications = await this.applicationRepository.findByUserId(input.userId, {
      stages: input.stages,
      priority: input.priority,
      pinned: input.pinned,
      followUp: input.followUp,
      stale: input.stale,
      staleDays: input.staleDays,
    });

    return applications.map((app) => ({
      id: app.id,
      userId: app.userId,
      jobId: app.jobId ?? null,
      companyName: app.companyName,
      jobTitle: app.jobTitle,
      status: app.status,
      priority: app.priority,
      appliedDate: app.appliedDate,
      location: app.location,
      source: app.source,
      notes: app.notes,
      pinnedAt: app.pinnedAt,
      archivedAt: app.archivedAt,
      nextFollowUpAt: app.nextFollowUpAt,
      lastActivityAt: app.lastActivityAt,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    }));
  }
}
