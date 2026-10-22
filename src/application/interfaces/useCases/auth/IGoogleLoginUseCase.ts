import { GoogleLoginInputDTO, LoginUserOutputDTO } from "../../../dtos/authDtos.js";

export interface IGoogleLoginUseCase {
  execute(dto: GoogleLoginInputDTO): Promise<LoginUserOutputDTO>;
}
