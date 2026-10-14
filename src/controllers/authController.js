import { authService } from "../services/authService.js";
import { registerSchema, loginSchema, googleAuthSchema } from "../shared/schemas/authSchemas.js";
import { env } from "../config/env.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  domain: env.COOKIE_DOMAIN === "localhost" ? undefined : `.${env.COOKIE_DOMAIN}`,
};

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie("accessToken", accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: 15 * 60 * 1000, // 15 mins
  });

  res.cookie("refreshToken", refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/api/v1/auth/refresh",
  });
}

function clearAuthCookies(res) {
  res.clearCookie("accessToken", COOKIE_OPTIONS);
  res.clearCookie("refreshToken", {
    ...COOKIE_OPTIONS,
    path: "/api/v1/auth/refresh",
  });
}

export const authController = {
  async register(req, res, next) {
    try {
      const data = registerSchema.parse(req.body);
      const session = await authService.register(data);

      setAuthCookies(res, session);
      res.status(201).json({
        data: {
          user: session.user,
          accessToken: session.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    try {
      const data = loginSchema.parse(req.body);
      const session = await authService.login(data);

      setAuthCookies(res, session);
      res.status(200).json({
        data: {
          user: session.user,
          accessToken: session.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async googleAuth(req, res, next) {
    try {
      const data = googleAuthSchema.parse(req.body);
      const session = await authService.googleLogin(data.idToken);

      setAuthCookies(res, session);
      res.status(200).json({
        data: {
          user: session.user,
          accessToken: session.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async refresh(req, res, next) {
    try {
      const rawRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
      if (!rawRefreshToken) {
        return res.status(401).json({
          error: {
            code: "REFRESH_TOKEN_REQUIRED",
            message: "Refresh token is missing",
            requestId: req.id || req.headers["x-request-id"] || "req_unknown",
          },
        });
      }

      const session = await authService.rotateRefreshToken(rawRefreshToken);
      setAuthCookies(res, session);

      res.status(200).json({
        data: {
          user: session.user,
          accessToken: session.accessToken,
        },
      });
    } catch (err) {
      clearAuthCookies(res);
      next(err);
    }
  },

  async logout(req, res) {
    clearAuthCookies(res);
    res.status(200).json({
      data: {
        message: "Successfully logged out",
      },
    });
  },

  async me(req, res) {
    res.status(200).json({
      data: {
        user: {
          id: req.user._id ? req.user._id.toString() : req.user.id,
          email: req.user.email,
          name: req.user.name,
          role: req.user.role,
          plan: req.user.plan,
          planVersion: req.user.planVersion,
          profileVersion: req.user.profileVersion,
        },
      },
    });
  },
};
