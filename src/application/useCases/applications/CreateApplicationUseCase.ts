import { injectable, inject } from "tsyringe";
import { IUseCase } from "../IUseCase.js";
import {
  CreateApplicationInputDTO,
  ApplicationOutputDTO,
  createApplicationInputSchema,
} from "../../dtos/applicationDtos.js";
import { IApplicationRepository } from "../../../domain/repositories/IApplicationRepository.js";
import { ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class CreateApplicationUseCase
  implements IUseCase<CreateApplicationInputDTO, ApplicationOutputDTO>
{
  constructor(
    @inject(TOKENS.ApplicationRepository)
    private readonly applicationRepository: IApplicationRepository,
  ) {}

  async execute(input: CreateApplicationInputDTO): Promise<ApplicationOutputDTO> {
    const parseResult = createApplicationInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid application details", parseResult.error.issues);
    }
    const data = parseResult.data;

    const created = await this.applicationRepository.create({
      userId: data.userId,
      jobId: data.jobId || null,
      companyName: data.company,
      jobTitle: data.role,
      status: data.status,
      priority: data.priority,
      appliedDate: new Date(),
      location: data.location,
      source: data.source,
      salaryMin: data.salaryMin ?? null,
      salaryMax: data.salaryMax ?? null,
      notes: data.notes,
      contacts: [],
      activityLog: [
        {
          action: "created",
          notes: "Application created",
          date: new Date(),
        },
      ],
      lastActivityAt: new Date(),
    });

    return {
      id: created.id,
      userId: created.userId,
      jobId: created.jobId ?? null,
      companyName: created.companyName,
      jobTitle: created.jobTitle,
      status: created.status,
      priority: created.priority,
      appliedDate: created.appliedDate,
      location: created.location,
      source: created.source,
      notes: created.notes,
      pinnedAt: created.pinnedAt,
      archivedAt: created.archivedAt,
      nextFollowUpAt: created.nextFollowUpAt,
      lastActivityAt: created.lastActivityAt,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }
}
