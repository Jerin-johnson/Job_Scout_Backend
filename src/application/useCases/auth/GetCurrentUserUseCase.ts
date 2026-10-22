import { injectable, inject } from "tsyringe";
import { IGetCurrentUserUseCase } from "../../interfaces/useCases/auth/IGetCurrentUserUseCase.js";
import { AuthUserDTO } from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class GetCurrentUserUseCase implements IGetCurrentUserUseCase {
  constructor(@inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository) {}

  async execute(userId: string): Promise<AuthUserDTO | null> {
    if (!userId) return null;
    const user = await this.userRepository.findById(userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.plan,
      isEmailVerified: user.isEmailVerified,
    };
  }
}
