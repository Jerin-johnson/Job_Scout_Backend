import { GetProfileInputDTO, ProfileOutputDTO } from "../../../dto/profileDtos.js";

export interface IGetProfileUseCase {
  execute(dto: GetProfileInputDTO): Promise<ProfileOutputDTO | null>;
}
