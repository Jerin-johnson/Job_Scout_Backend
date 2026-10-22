import { injectable, inject } from "tsyringe";
import crypto from "node:crypto";
import { IUseCase } from "../IUseCase.js";
import {
  GoogleLoginInputDTO,
  LoginUserOutputDTO,
  googleLoginInputSchema,
} from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { ITokenService } from "../../../domain/security/ITokenService.js";
import { IOAuthService } from "../../../domain/security/IOAuthService.js";
import { ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

@injectable()
export class GoogleLoginUseCase implements IUseCase<GoogleLoginInputDTO, LoginUserOutputDTO> {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository,
    @inject(TOKENS.TokenService) private readonly tokenService: ITokenService,
    @inject(TOKENS.OAuthService) private readonly oauthService: IOAuthService,
  ) {}

  async execute(input: GoogleLoginInputDTO): Promise<LoginUserOutputDTO> {
    const parseResult = googleLoginInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid Google login input", parseResult.error.issues);
    }

    const { idToken } = parseResult.data;
    const profile = await this.oauthService.verifyGoogleToken(idToken);

    let user = await this.userRepository.findByEmail(profile.email);
    if (!user) {
      user = await this.userRepository.create({
        email: profile.email,
        googleId: profile.sub,
        name: profile.name || "",
      });
    } else if (!user.googleId) {
      user = (await this.userRepository.update(user.id, { googleId: profile.sub })) || user;
    }

    const familyId = crypto.randomUUID();
    const generatedAccessToken = this.tokenService.generateAccessToken({
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

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.userRepository.addRefreshToken(user.id, {
      tokenHash: hashToken(refreshToken),
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
        isEmailVerified: user.isEmailVerified,
      },
      tokens: {
        accessToken: generatedAccessToken,
        refreshToken,
      },
    };
  }
}
