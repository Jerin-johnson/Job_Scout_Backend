import { LoginUserInputDTO, LoginUserOutputDTO } from "../../../dto/authDtos.js";

export interface ILoginUserUseCase {
  execute(dto: LoginUserInputDTO): Promise<LoginUserOutputDTO>;
}
