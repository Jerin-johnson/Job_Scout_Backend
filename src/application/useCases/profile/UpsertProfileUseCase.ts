import { injectable, inject } from "tsyringe";
import { IUseCase } from "../IUseCase.js";
import {
  UpsertProfileInputDTO,
  ProfileOutputDTO,
  upsertProfileInputSchema,
} from "../../dtos/profileDtos.js";
import { IProfileRepository } from "../../../domain/repositories/IProfileRepository.js";
import { ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class UpsertProfileUseCase
  implements IUseCase<UpsertProfileInputDTO, ProfileOutputDTO>
{
  constructor(
    @inject(TOKENS.ProfileRepository)
    private readonly profileRepository: IProfileRepository,
  ) {}

  async execute(input: UpsertProfileInputDTO): Promise<ProfileOutputDTO> {
    const parseResult = upsertProfileInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid profile update details", parseResult.error.issues);
    }
    const data = parseResult.data;

    const updated = await this.profileRepository.upsertProfile(data.userId, {
      skills: data.skills,
      roles: data.roles,
      preferences: data.preferences,
      careerProfile: data.careerProfile,
    });

    return {
      id: updated.id,
      userId: updated.userId,
      skills: updated.skills,
      roles: updated.roles,
      preferences: updated.preferences,
      careerProfile: updated.careerProfile,
      matchTokens: updated.matchTokens || [],
      matchCountryCodes: updated.matchCountryCodes || [],
      version: updated.version,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
