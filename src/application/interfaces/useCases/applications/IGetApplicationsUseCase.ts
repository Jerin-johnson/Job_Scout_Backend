import { GetApplicationsInputDTO, ApplicationOutputDTO } from "../../../dto/applicationDtos.js";

export interface IGetApplicationsUseCase {
  execute(dto: GetApplicationsInputDTO): Promise<ApplicationOutputDTO[]>;
}
