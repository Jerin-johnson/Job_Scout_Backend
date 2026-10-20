import { RegisterUserInputDTO, RegisterUserOutputDTO } from "../../../dto/authDtos.js";

export interface IRegisterUserUseCase {
  execute(dto: RegisterUserInputDTO): Promise<RegisterUserOutputDTO>;
}
