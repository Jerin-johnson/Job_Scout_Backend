import {
  UpdateApplicationStatusInputDTO,
  ApplicationOutputDTO,
} from "../../../dto/applicationDtos.js";

export interface IUpdateApplicationStatusUseCase {
  execute(dto: UpdateApplicationStatusInputDTO): Promise<ApplicationOutputDTO>;
}
