import { injectable, inject } from "tsyringe";
import crypto from "node:crypto";
import { IUseCase } from "../IUseCase.js";
import { LoginUserInputDTO, LoginUserOutputDTO, loginInputSchema } from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { IPasswordHasher } from "../../../domain/security/IPasswordHasher.js";
import { ITokenService } from "../../../domain/security/ITokenService.js";
import {
  UnauthorizedError,
  ValidationError,
  EmailNotVerifiedError,
} from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

@injectable()
export class LoginUserUseCase implements IUseCase<LoginUserInputDTO, LoginUserOutputDTO> {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository,
    @inject(TOKENS.PasswordHasher) private readonly passwordHasher: IPasswordHasher,
    @inject(TOKENS.TokenService) private readonly tokenService: ITokenService,
  ) {}

  async execute(input: LoginUserInputDTO): Promise<LoginUserOutputDTO> {
    const parseResult = loginInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid login credentials", parseResult.error.issues);
    }
    const { email, password } = parseResult.data;

    const user = await this.userRepository.findByEmail(email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const isPasswordValid = await this.passwordHasher.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION !== "false";
    if (requireVerification && user.isEmailVerified === false) {
      throw new EmailNotVerifiedError("Please verify your email address before signing in.", {
        email: user.email,
      });
    }

    const familyId = crypto.randomUUID();
    const token = this.tokenService.generateAccessToken({
      userId: user.id,
      role: user.role,
      plan: user.plan,
    });
    const refreshToken = this.tokenService.generateRefreshToken({
      userId: user.id,
      role: user.role,
      plan: user.plan,
      familyId,
    });

    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.userRepository.addRefreshToken(user.id, {
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
      createdAt: new Date(),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.plan,
        isEmailVerified: user.isEmailVerified,
      },
      tokens: {
        accessToken: token,
        refreshToken,
      },
    };
  }
}
