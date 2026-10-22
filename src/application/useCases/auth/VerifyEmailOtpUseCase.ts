import { injectable, inject } from "tsyringe";
import crypto from "node:crypto";
import { IUseCase } from "../IUseCase.js";
import {
  VerifyOtpInputDTO,
  VerifyOtpOutputDTO,
  verifyOtpInputSchema,
} from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { ITokenService } from "../../../domain/security/ITokenService.js";
import { BadRequestError, NotFoundError, ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

@injectable()
export class VerifyEmailOtpUseCase implements IUseCase<VerifyOtpInputDTO, VerifyOtpOutputDTO> {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository,
    @inject(TOKENS.TokenService) private readonly tokenService: ITokenService,
  ) {}

  async execute(input: VerifyOtpInputDTO): Promise<VerifyOtpOutputDTO> {
    const parseResult = verifyOtpInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid verification input", parseResult.error.issues);
    }
    const { email, otp } = parseResult.data;

    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new NotFoundError("No account found with this email address");
    }

    if (user.isEmailVerified && !user.emailVerificationOtpHash) {
      // User is already verified, generate tokens
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
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          plan: user.plan,
          isEmailVerified: true,
        },
        tokens: {
          accessToken: generatedAccessToken,
          refreshToken: generatedRefreshToken,
        },
      };
    }

    if (
      !user.emailVerificationOtpExpiresAt ||
      new Date(user.emailVerificationOtpExpiresAt) < new Date()
    ) {
      throw new BadRequestError("Verification code has expired. Please request a new code.");
    }

    const incomingHash = hashToken(otp);
    if (incomingHash !== user.emailVerificationOtpHash) {
      throw new BadRequestError(
        "Invalid verification code. Please check your email and try again.",
      );
    }

    // Mark email as verified and clear OTP
    await this.userRepository.verifyEmail(user.id);

    // Issue authentication tokens
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
        isEmailVerified: true,
      },
      tokens: {
        accessToken: generatedAccessToken,
        refreshToken: generatedRefreshToken,
      },
    };
  }
}
