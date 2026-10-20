import { CreateApplicationInputDTO, ApplicationOutputDTO } from "../../../dto/applicationDtos.js";

export interface ICreateApplicationUseCase {
  execute(dto: CreateApplicationInputDTO): Promise<ApplicationOutputDTO>;
}
