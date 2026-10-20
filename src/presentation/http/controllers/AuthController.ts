import { Request, Response, NextFunction, CookieOptions } from "express";
import { injectable, inject } from "tsyringe";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { RegisterUserUseCase } from "../../../application/useCases/auth/RegisterUserUseCase.js";
import { LoginUserUseCase } from "../../../application/useCases/auth/LoginUserUseCase.js";
import { RefreshTokenUseCase } from "../../../application/useCases/auth/RefreshTokenUseCase.js";
import { VerifyEmailOtpUseCase } from "../../../application/useCases/auth/VerifyEmailOtpUseCase.js";
import { ResendOtpUseCase } from "../../../application/useCases/auth/ResendOtpUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { env } from "../../../config/env.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";
import { authService } from "../../../infrastructure/security/authService.js";
import { googleAuthSchema } from "../../../shared/schemas/authSchemas.js";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse, errorResponse } from "../../../shared/types/apiResponse.js";
import { appContainer } from "../../../main/container.js";

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  domain: env.COOKIE_DOMAIN === "localhost" ? undefined : `.${env.COOKIE_DOMAIN}`,
};

interface SessionResult {
  accessToken: string;
  refreshToken: string;
  user: unknown;
  [key: string]: unknown;
}

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
    private readonly registerUseCase: RegisterUserUseCase,
    @inject(TOKENS.LoginUserUseCase)
    private readonly loginUseCase: LoginUserUseCase,
    @inject(TOKENS.RefreshTokenUseCase)
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    @inject(TOKENS.VerifyEmailOtpUseCase)
    private readonly verifyEmailOtpUseCase: VerifyEmailOtpUseCase,
    @inject(TOKENS.ResendOtpUseCase)
    private readonly resendOtpUseCase: ResendOtpUseCase,
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
}

export const authController = {
  register: (req: Request, res: Response, next: NextFunction): void => {
    void appContainer.resolve(AuthController).register(req, res, next);
  },

  login: (req: Request, res: Response, next: NextFunction): void => {
    void appContainer.resolve(AuthController).login(req, res, next);
  },

  verifyOtp: (req: Request, res: Response, next: NextFunction): void => {
    void appContainer.resolve(AuthController).verifyOtp(req, res, next);
  },

  resendOtp: (req: Request, res: Response, next: NextFunction): void => {
    void appContainer.resolve(AuthController).resendOtp(req, res, next);
  },

  googleAuth: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const data = googleAuthSchema.parse(req.body);
    const session = (await authService.googleLogin(data.idToken)) as SessionResult;

    setAuthCookies(res, session);
    const token = session.accessToken;
    res.status(200).json(
      successResponse({
        user: session.user,
        accessToken: token,
      }),
    );
  }),

  refresh: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const rawRefreshToken =
      (req.cookies?.refreshToken as string | undefined) ||
      (req.body?.refreshToken as string | undefined);
    if (!rawRefreshToken) {
      res
        .status(401)
        .json(
          errorResponse(
            "REFRESH_TOKEN_REQUIRED",
            "Refresh token is missing",
            req.id ? String(req.id) : (req.headers["x-request-id"] as string) || undefined,
          ),
        );
      return;
    }

    try {
      const session = (await authService.rotateRefreshToken(rawRefreshToken)) as SessionResult;
      setAuthCookies(res, session);

      const token = session.accessToken;
      res.status(200).json(
        successResponse({
          user: session.user,
          accessToken: token,
        }),
      );
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  }),

  logout: asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    clearAuthCookies(res);
    res.status(200).json(
      successResponse({
        message: "Successfully logged out",
      }),
    );
  }),

  me: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const rawUser = req.user as Record<string, unknown> | undefined;
    const userId = String(rawUser?.userId || rawUser?._id || rawUser?.id || "");
    const userRepo = appContainer.resolve<IUserRepository>(TOKENS.UserRepository);
    const user = userId ? await userRepo.findById(userId) : null;
    res.status(200).json(
      successResponse({
        user: {
          id: user?.id || userId,
          email: user?.email || (rawUser?.email as string | undefined),
          name: user?.name || (rawUser?.name as string | undefined),
          role: user?.role || (rawUser?.role as string | undefined) || "user",
          plan: user?.plan || (rawUser?.plan as string | undefined) || "free",
          planVersion: user?.planVersion || 1,
          profileVersion: user?.profileVersion || 1,
        },
      }),
    );
  }),
};
