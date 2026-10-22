import { Request, Response, CookieOptions } from "express";
import { injectable, inject } from "tsyringe";
import { IRegisterUserUseCase } from "../../../application/interfaces/useCases/auth/IRegisterUserUseCase.js";
import { ILoginUserUseCase } from "../../../application/interfaces/useCases/auth/ILoginUserUseCase.js";
import { IRefreshTokenUseCase } from "../../../application/interfaces/useCases/auth/IRefreshTokenUseCase.js";
import { IVerifyEmailOtpUseCase } from "../../../application/interfaces/useCases/auth/IVerifyEmailOtpUseCase.js";
import { IResendOtpUseCase } from "../../../application/interfaces/useCases/auth/IResendOtpUseCase.js";
import { IGoogleLoginUseCase } from "../../../application/interfaces/useCases/auth/IGoogleLoginUseCase.js";
import { IGetCurrentUserUseCase } from "../../../application/interfaces/useCases/auth/IGetCurrentUserUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { env } from "../../../config/env.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse } from "../../../shared/types/apiResponse.js";
import { appContainer } from "../../../main/container.js";

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  domain: env.COOKIE_DOMAIN === "localhost" ? undefined : `.${env.COOKIE_DOMAIN}`,
};

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie("accessToken", tokens.accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", tokens.refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/api/v1/auth/refresh",
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie("accessToken", COOKIE_OPTIONS);
  res.clearCookie("refreshToken", {
    ...COOKIE_OPTIONS,
    path: "/api/v1/auth/refresh",
  });
}

@injectable()
export class AuthController {
  constructor(
    @inject(TOKENS.RegisterUserUseCase)
    private readonly registerUseCase: IRegisterUserUseCase,
    @inject(TOKENS.LoginUserUseCase)
    private readonly loginUseCase: ILoginUserUseCase,
    @inject(TOKENS.RefreshTokenUseCase)
    private readonly refreshTokenUseCase: IRefreshTokenUseCase,
    @inject(TOKENS.VerifyEmailOtpUseCase)
    private readonly verifyEmailOtpUseCase: IVerifyEmailOtpUseCase,
    @inject(TOKENS.ResendOtpUseCase)
    private readonly resendOtpUseCase: IResendOtpUseCase,
    @inject(TOKENS.GoogleLoginUseCase)
    private readonly googleLoginUseCase: IGoogleLoginUseCase,
    @inject(TOKENS.GetCurrentUserUseCase)
    private readonly getCurrentUserUseCase: IGetCurrentUserUseCase,
  ) {}

  register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.registerUseCase.execute(req.body);
    if (result.tokens) {
      setAuthCookies(res, result.tokens);
    }
    const token = result.tokens?.accessToken;
    res.status(201).json(
      successResponse({
        user: result.user,
        requiresVerification: result.requiresVerification,
        message: result.message,
        accessToken: token,
      }),
    );
  });

  login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const session = await this.loginUseCase.execute(req.body);
    setAuthCookies(res, session.tokens);
    const token = session.tokens.accessToken;
    res.status(200).json(
      successResponse({
        user: session.user,
        accessToken: token,
      }),
    );
  });

  verifyOtp = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const session = await this.verifyEmailOtpUseCase.execute(req.body);
    setAuthCookies(res, session.tokens);
    const token = session.tokens.accessToken;
    res.status(200).json(
      successResponse({
        user: session.user,
        accessToken: token,
        message: session.message,
      }),
    );
  });

  resendOtp = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.resendOtpUseCase.execute(req.body);
    res.status(200).json(successResponse(result));
  });

  googleAuth = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const session = await this.googleLoginUseCase.execute(req.body);
    setAuthCookies(res, session.tokens);
    const token = session.tokens.accessToken;
    res.status(200).json(
      successResponse({
        user: session.user,
        accessToken: token,
      }),
    );
  });

  refresh = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const cookies = (req.cookies || {}) as Record<string, string | undefined>;
    const body = (req.body || {}) as Record<string, string | undefined>;
    const rawRefreshToken = cookies.refreshToken || body.refreshToken;

    if (!rawRefreshToken) {
      throw new UnauthorizedError("Refresh token is missing");
    }

    const tokens = await this.refreshTokenUseCase.execute({
      refreshToken: rawRefreshToken,
    });

    setAuthCookies(res, tokens);
    const token = tokens.accessToken;
    res.status(200).json(
      successResponse({
        accessToken: token,
      }),
    );
  });

  logout = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    clearAuthCookies(res);
    res.status(200).json(
      successResponse({
        message: "Successfully logged out",
      }),
    );
  });

  me = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const rawUser = req.user as Record<string, unknown> | undefined;
    const userId = String(rawUser?.userId || rawUser?._id || rawUser?.id || "");
    const user = await this.getCurrentUserUseCase.execute(userId);
    res.status(200).json(
      successResponse({
        user: {
          id: user?.id || userId,
          email: user?.email || (rawUser?.email as string | undefined),
          name: user?.name || (rawUser?.name as string | undefined),
          role: user?.role || (rawUser?.role as string | undefined) || "user",
          plan: user?.plan || (rawUser?.plan as string | undefined) || "free",
          planVersion: (rawUser?.planVersion as number | undefined) || 1,
          profileVersion: (rawUser?.profileVersion as number | undefined) || 1,
        },
      }),
    );
  });
}

export const authController = new Proxy({} as AuthController, {
  get(_target, prop) {
    const instance = appContainer.resolve(AuthController);
    const value = (instance as unknown as Record<string, unknown>)[prop as string];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(instance)
      : value;
  },
});
