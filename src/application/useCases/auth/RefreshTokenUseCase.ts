import { injectable, inject } from "tsyringe";
import crypto from "node:crypto";
import { IUseCase } from "../IUseCase.js";
import { RefreshTokenInputDTO, RefreshTokenOutputDTO, refreshTokenInputSchema } from "../../dtos/authDtos.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { ITokenService } from "../../../domain/security/ITokenService.js";
import { UnauthorizedError, ValidationError } from "../../errors/ApplicationError.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

@injectable()
export class RefreshTokenUseCase implements IUseCase<RefreshTokenInputDTO, RefreshTokenOutputDTO> {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepository: IUserRepository,
    @inject(TOKENS.TokenService) private readonly tokenService: ITokenService,
  ) {}

  async execute(input: RefreshTokenInputDTO): Promise<RefreshTokenOutputDTO> {
    const parseResult = refreshTokenInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError("Invalid refresh token", parseResult.error.issues);
    }
    const { refreshToken: rawRefreshToken } = parseResult.data;

    let payload;
    try {
      payload = this.tokenService.verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    const { userId, familyId } = payload;
    if (!familyId) {
      throw new UnauthorizedError("Invalid refresh token payload");
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedError("User associated with token not found");
    }

    const tokenHash = hashToken(rawRefreshToken);
    const existingToken = (user.refreshTokens || []).find((t) => t.tokenHash === tokenHash);

    if (!existingToken) {
      await this.userRepository.revokeTokenFamily(user.id, familyId);
      throw new UnauthorizedError("Refresh token reuse detected. Please log in again.");
    }

    await this.userRepository.revokeTokenFamily(user.id, familyId);

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
      accessToken: generatedAccessToken,
      refreshToken: generatedRefreshToken,
    };
  }
}
