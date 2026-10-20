import { Request, Response, CookieOptions } from "express";
import { injectable, inject } from "tsyringe";
import { RegisterUserUseCase } from "../../../application/useCases/auth/RegisterUserUseCase.js";
import { LoginUserUseCase } from "../../../application/useCases/auth/LoginUserUseCase.js";
import { RefreshTokenUseCase } from "../../../application/useCases/auth/RefreshTokenUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { env } from "../../../config/env.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";
import { authService } from "../../../infrastructure/security/authService.js";
import {
  registerSchema,
  loginSchema,
  googleAuthSchema,
} from "../../../shared/schemas/authSchemas.js";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse, errorResponse } from "../../../shared/types/apiResponse.js";

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
  ) {}

  register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const session = await this.registerUseCase.execute(req.body);
    setAuthCookies(res, session.tokens);
    const authToken = session.tokens.accessToken;
    res.status(201).json(
      successResponse({
        user: session.user,
        accessToken: authToken,
      }),
    );
  });

  login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const session = await this.loginUseCase.execute(req.body);
    setAuthCookies(res, session.tokens);
    const authToken = session.tokens.accessToken;
    res.status(200).json(
      successResponse({
        user: session.user,
        accessToken: authToken,
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
    res.status(200).json(
      successResponse({
        accessToken: tokens.accessToken,
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
  register: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const data = registerSchema.parse(req.body);
    const session = (await authService.register(data)) as SessionResult;

    setAuthCookies(res, session);
    res.status(201).json(
      successResponse({
        user: session.user,
        accessToken: session.accessToken,
      }),
    );
  }),

  login: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const data = loginSchema.parse(req.body);
    const session = (await authService.login({
      email: data.email,
      password: data.password,
    })) as SessionResult;

    setAuthCookies(res, session);
    res.status(200).json(
      successResponse({
        user: session.user,
        accessToken: session.accessToken,
      }),
    );
  }),

  googleAuth: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const data = googleAuthSchema.parse(req.body);
    const session = (await authService.googleLogin(data.idToken)) as SessionResult;

    setAuthCookies(res, session);
    res.status(200).json(
      successResponse({
        user: session.user,
        accessToken: session.accessToken,
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

      res.status(200).json(
        successResponse({
          user: session.user,
          accessToken: session.accessToken,
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
    const user = req.user as UserRecord;
    res.status(200).json(
      successResponse({
        user: {
          id: user?._id ? user._id.toString() : (user as unknown as { id?: string })?.id,
          email: user?.email,
          name: user?.name,
          role: user?.role,
          plan: user?.plan,
          planVersion: user?.planVersion,
          profileVersion: user?.profileVersion,
        },
      }),
    );
  }),
};
