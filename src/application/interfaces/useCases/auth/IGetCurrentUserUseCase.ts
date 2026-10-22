import { AuthUserDTO } from "../../../dtos/authDtos.js";

export interface IGetCurrentUserUseCase {
  execute(userId: string): Promise<AuthUserDTO | null>;
}
