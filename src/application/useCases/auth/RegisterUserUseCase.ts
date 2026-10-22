import { injectable, inject } from "tsyringe";
import crypto from "node:crypto";
import { IUseCase } from "../IUseCase.js";
import {
  RegisterUserInputDTO,
  RegisterUserOutputDTO,
  registerInputSchema,
} from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { IPasswordHasher } from "../../../domain/security/IPasswordHasher.js";
import { ITokenService } from "../../../domain/security/ITokenService.js";
import { IEmailService } from "../../../domain/notifications/IEmailService.js";
import { ConflictError, ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { generateOtpEmailHtml } from "../../../domain/notifications/templates/otpEmailTemplate.js";
import { logger } from "../../../shared/utils/logger.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

@injectable()
export class RegisterUserUseCase implements IUseCase<RegisterUserInputDTO, RegisterUserOutputDTO> {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository,
    @inject(TOKENS.PasswordHasher) private readonly passwordHasher: IPasswordHasher,
    @inject(TOKENS.TokenService) private readonly tokenService: ITokenService,
    @inject(TOKENS.EmailService) private readonly emailService?: IEmailService,
  ) {}

  async execute(input: RegisterUserInputDTO): Promise<RegisterUserOutputDTO> {
    const parseResult = registerInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid registration data", parseResult.error.issues);
    }
    const { email, password, name } = parseResult.data;

    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictError("An account with this email already exists");
    }

    const passwordHash = await this.passwordHasher.hash(password);

    // Generate 6-digit numeric OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashToken(otp);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION !== "false";

    const user = await this.userRepository.create({
      email,
      name,
      passwordHash,
      role: "user",
      plan: "free",
      isEmailVerified: !requireVerification,
      emailVerificationOtpHash: otpHash,
      emailVerificationOtpExpiresAt: otpExpiresAt,
    });

    // Send verification email via email service
    if (this.emailService) {
      try {
        await this.emailService.sendEmail({
          toEmail: user.email,
          subject: "Verify your JobScout account",
          html: generateOtpEmailHtml(user.name, otp),
        });
      } catch (err) {
        logger.warn({ error: err, email: user.email }, "Failed to dispatch verification email");
      }
    }

    // Always log OTP for development/testing convenience
    logger.info({ email: user.email, otp }, "[AUTH] Email verification OTP dispatched");

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

    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.userRepository.addRefreshToken(user.id, {
      tokenHash: hashToken(generatedRefreshToken),
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
      requiresVerification: requireVerification ? !user.isEmailVerified : false,
      message: "A 6-digit verification code has been sent to your email address.",
      tokens: {
        accessToken: generatedAccessToken,
        refreshToken: generatedRefreshToken,
      },
    };
  }
}
