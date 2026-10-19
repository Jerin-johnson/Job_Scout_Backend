import { injectable, inject } from "tsyringe";
import crypto from "node:crypto";
import { IUseCase } from "../IUseCase.js";
import { LoginUserInputDTO, LoginUserOutputDTO, loginInputSchema } from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { IPasswordHasher } from "../../../domain/security/IPasswordHasher.js";
import { ITokenService } from "../../../domain/security/ITokenService.js";
import { UnauthorizedError, BadRequestError, ValidationError, QuotaExceededError } from "../../errors/ApplicationError.js";
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
      throw new ValidationError("Invalid login details", parseResult.error.issues);
    }
    const { email, password } = parseResult.data;

    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
      const minutesRemaining = Math.ceil((new Date(user.lockUntil).getTime() - Date.now()) / 60000);
      throw new QuotaExceededError(
        `Account temporarily locked due to repeated failed logins. Try again in ${minutesRemaining} minutes.`,
      );
    }

    if (!user.passwordHash) {
      throw new BadRequestError("Please log in with Google OAuth");
    }

    const isMatch = await this.passwordHasher.compare(password, user.passwordHash);
    if (!isMatch) {
      await this.userRepository.recordFailedLogin(user.id, user.failedLoginAttempts || 0);
      throw new UnauthorizedError("Invalid email or password");
    }

    if (user.failedLoginAttempts > 0) {
      await this.userRepository.resetFailedLogins(user.id);
    }

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
