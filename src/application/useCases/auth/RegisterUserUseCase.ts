import { injectable, inject } from "tsyringe";
import crypto from "node:crypto";
import { IUseCase } from "../IUseCase.js";
import { RegisterUserInputDTO, RegisterUserOutputDTO, registerInputSchema } from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { IPasswordHasher } from "../../../domain/security/IPasswordHasher.js";
import { ITokenService } from "../../../domain/security/ITokenService.js";
import { ConflictError, ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

@injectable()
export class RegisterUserUseCase implements IUseCase<RegisterUserInputDTO, RegisterUserOutputDTO> {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository,
    @inject(TOKENS.PasswordHasher) private readonly passwordHasher: IPasswordHasher,
    @inject(TOKENS.TokenService) private readonly tokenService: ITokenService,
  ) {}

  async execute(input: RegisterUserInputDTO): Promise<RegisterUserOutputDTO> {
    const parseResult = registerInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid registration details", parseResult.error.issues);
    }
    const { email, password, name } = parseResult.data;

    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictError("An account with this email already exists");
    }

    const passwordHash = await this.passwordHasher.hash(password);
    const user = await this.userRepository.create({
      email,
      passwordHash,
      name,
    });

    const familyId = crypto.randomUUID();
    const generatedAccessToken = this.tokenService.generateAccessToken({
      userId: user.id,
      role: user.role,
      plan: user.plan,
    });
    const generatedRefreshToken = this.tokenService.generateRefreshToken({
      userId: user.id,
      role: user.role,
      plan: user.plan,
      familyId,
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.userRepository.addRefreshToken(user.id, {
      tokenHash: hashToken(generatedRefreshToken),
      familyId,
      expiresAt,
      createdAt: new Date(),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.plan,
      },
      tokens: {
        accessToken: generatedAccessToken,
        refreshToken: generatedRefreshToken,
      },
    };
  }
}
