import { injectable, inject } from "tsyringe";
import crypto from "node:crypto";
import { IUseCase } from "../IUseCase.js";
import {
  ResendOtpInputDTO,
  ResendOtpOutputDTO,
  resendOtpInputSchema,
} from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { IEmailService } from "../../../domain/notifications/IEmailService.js";
import { BadRequestError, NotFoundError, ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { generateOtpEmailHtml } from "../../../domain/notifications/templates/otpEmailTemplate.js";
import { logger } from "../../../shared/utils/logger.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

@injectable()
export class ResendOtpUseCase implements IUseCase<ResendOtpInputDTO, ResendOtpOutputDTO> {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository,
    @inject(TOKENS.EmailService) private readonly emailService: IEmailService,
  ) {}

  async execute(input: ResendOtpInputDTO): Promise<ResendOtpOutputDTO> {
    const parseResult = resendOtpInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid resend request", parseResult.error.issues);
    }
    const { email } = parseResult.data;

    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new NotFoundError("No account found with this email address");
    }

    if (user.isEmailVerified) {
      throw new BadRequestError("This account is already verified. You can sign in directly.");
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashToken(otp);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.userRepository.setEmailVerificationOtp(user.id, otpHash, otpExpiresAt);

    if (this.emailService) {
      try {
        await this.emailService.sendEmail({
          toEmail: user.email,
          subject: "Your new JobScout verification code",
          html: generateOtpEmailHtml(user.name, otp),
        });
      } catch (err) {
        logger.warn({ error: err, email: user.email }, "Failed to resend verification email");
      }
    }

    logger.info({ email: user.email, otp }, "[AUTH] Email verification OTP resent");

    return {
      message: "A fresh verification code has been sent to your email address.",
    };
  }
}
