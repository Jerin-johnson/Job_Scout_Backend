import { injectable, inject } from "tsyringe";
import { IUseCase } from "../IUseCase.js";
import { GetProfileInputDTO, ProfileOutputDTO, getProfileInputSchema } from "../../dtos/profileDtos.js";
import { IProfileRepository } from "../../../domain/repositories/IProfileRepository.js";
import { NotFoundError, ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class GetProfileUseCase implements IUseCase<GetProfileInputDTO, ProfileOutputDTO> {
  constructor(
    @inject(TOKENS.ProfileRepository)
    private readonly profileRepository: IProfileRepository,
  ) {}

  async execute(input: GetProfileInputDTO): Promise<ProfileOutputDTO> {
    const parseResult = getProfileInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid get profile input", parseResult.error.issues);
    }
    const { userId } = parseResult.data;

    const profile = await this.profileRepository.findByUserId(userId);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }

    return {
      id: profile.id,
      userId: profile.userId,
      skills: profile.skills,
      roles: profile.roles,
      preferences: profile.preferences,
      careerProfile: profile.careerProfile,
      matchTokens: profile.matchTokens || [],
      matchCountryCodes: profile.matchCountryCodes || [],
      version: profile.version,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
