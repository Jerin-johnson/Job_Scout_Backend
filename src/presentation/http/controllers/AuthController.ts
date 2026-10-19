import { Request, Response, NextFunction } from "express";
import { injectable, inject } from "tsyringe";
import { RegisterUserUseCase } from "../../../application/useCases/auth/RegisterUserUseCase.js";
import { LoginUserUseCase } from "../../../application/useCases/auth/LoginUserUseCase.js";
import { RefreshTokenUseCase } from "../../../application/useCases/auth/RefreshTokenUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { env } from "../../../config/env.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  domain: env.COOKIE_DOMAIN === "localhost" ? undefined : `.${env.COOKIE_DOMAIN}`,
};

function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
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

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await this.registerUseCase.execute(req.body);
      setAuthCookies(res, session.tokens);
      const authToken = session.tokens.accessToken;
      res.status(201).json({
        data: {
          user: session.user,
          accessToken: authToken,
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await this.loginUseCase.execute(req.body);
      setAuthCookies(res, session.tokens);
      const authToken = session.tokens.accessToken;
      res.status(200).json({
        data: {
          user: session.user,
          accessToken: authToken,
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
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
      res.status(200).json({
        data: {
          accessToken: tokens.accessToken,
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  logout = async (_req: Request, res: Response): Promise<void> => {
    clearAuthCookies(res);
    res.status(200).json({
      data: {
        message: "Successfully logged out",
      },
    });
  };
}
