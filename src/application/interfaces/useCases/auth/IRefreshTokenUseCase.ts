import { RefreshTokenInputDTO, RefreshTokenOutputDTO } from "../../../dto/authDtos.js";

export interface IRefreshTokenUseCase {
  execute(dto: RefreshTokenInputDTO): Promise<RefreshTokenOutputDTO>;
}
