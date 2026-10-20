import { UpsertProfileInputDTO, ProfileOutputDTO } from "../../../dto/profileDtos.js";

export interface IUpsertProfileUseCase {
  execute(dto: UpsertProfileInputDTO): Promise<ProfileOutputDTO>;
}
