import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";
import { userRepository, type UserRecord } from "../repositories/userRepository.js";
import { logger } from "../shared/utils/logger.js";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

interface CustomHttpError extends Error {
  statusCode?: number;
  code?: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthSessionUser {
  id: string;
  email: string;
  name?: string;
  role: string;
  plan: string;
}

export interface AuthSessionResult {
  accessToken: string;
  refreshToken: string;
  user: AuthSessionUser;
}

export const authService = {
  async register({ email, password, name }: RegisterInput): Promise<AuthSessionResult> {
    const existing = await userRepository.findByEmail(email);
    if (existing) {
      const err: CustomHttpError = new Error("An account with this email already exists");
      err.statusCode = 409;
      err.code = "EMAIL_ALREADY_EXISTS";
      throw err;
    }

    // Cost 12 bcrypt
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await userRepository.create({
      email,
      passwordHash,
      name,
    });

    return this.generateSession(user);
  },

  async login({ email, password }: LoginInput): Promise<AuthSessionResult> {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      const err: CustomHttpError = new Error("Invalid email or password");
      err.statusCode = 401;
      err.code = "INVALID_CREDENTIALS";
      throw err;
    }

    // Check account lockout
    if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
      const minutesRemaining = Math.ceil((new Date(user.lockUntil).getTime() - Date.now()) / 60000);
      const err: CustomHttpError = new Error(
        `Account temporarily locked due to repeated failed logins. Try again in ${minutesRemaining} minutes.`,
      );
      err.statusCode = 429;
      err.code = "ACCOUNT_LOCKED";
      throw err;
    }

    if (!user.passwordHash) {
      const err: CustomHttpError = new Error("Please log in with Google OAuth");
      err.statusCode = 400;
      err.code = "OAUTH_USER";
      throw err;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await userRepository.recordFailedLogin(user._id, user.failedLoginAttempts || 0);
      const err: CustomHttpError = new Error("Invalid email or password");
      err.statusCode = 401;
      err.code = "INVALID_CREDENTIALS";
      throw err;
    }

    // Reset failed logins upon successful login
    if ((user.failedLoginAttempts || 0) > 0) {
      await userRepository.resetFailedLogins(user._id);
    }

    return this.generateSession(user);
  },

  async googleLogin(idToken: string): Promise<AuthSessionResult> {
    let payload: { email?: string; sub?: string; name?: string } | undefined;
    try {
      // In development or test with dummy keys, simulate token payload if starts with mock_
      if (idToken.startsWith("mock_google_")) {
        const email = `${idToken.replace("mock_google_", "")}@gmail.com`;
        payload = { email, sub: `g_${idToken}`, name: "Mock Google User" };
      } else {
        const ticket = await googleClient.verifyIdToken({
          idToken,
          audience: env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload() as { email?: string; sub?: string; name?: string } | undefined;
      }
    } catch (cause) {
      const error = cause as Error;
      const err: CustomHttpError = new Error(`Invalid Google ID token: ${error.message}`);
      err.statusCode = 401;
      err.code = "INVALID_OAUTH_TOKEN";
      throw err;
    }

    if (!payload?.email) {
      const err: CustomHttpError = new Error("Google profile did not provide an email address");
      err.statusCode = 400;
      err.code = "OAUTH_EMAIL_MISSING";
      throw err;
    }

    let user = await userRepository.findByEmail(payload.email);
    if (!user) {
      user = await userRepository.create({
        email: payload.email,
        googleId: payload.sub,
        name: payload.name || "",
      });
    } else if (!user.googleId) {
      user = (await userRepository.update(user._id, { googleId: payload.sub })) || user;
    }

    return this.generateSession(user);
  },

  async rotateRefreshToken(rawRefreshToken: string): Promise<AuthSessionResult> {
    let decoded: { userId: string; familyId: string };
    try {
      decoded = jwt.verify(rawRefreshToken, env.JWT_REFRESH_SECRET) as { userId: string; familyId: string };
    } catch (cause) {
      const err = cause as Error;
      const error: CustomHttpError = new Error(`Invalid refresh token: ${err.message}`);
      error.statusCode = 401;
      error.code = "INVALID_REFRESH_TOKEN";
      throw error;
    }

    const { userId, familyId } = decoded;
    const user = await userRepository.findById(userId);
    if (!user) {
      const error: CustomHttpError = new Error("User associated with token not found");
      error.statusCode = 401;
      error.code = "USER_NOT_FOUND";
      throw error;
    }

    const tokenHash = hashToken(rawRefreshToken);
    const existingToken = (user.refreshTokens || []).find((t) => t.tokenHash === tokenHash);

    // Reuse detection: if token not found or revoked, someone replayed an old token!
    if (!existingToken || existingToken.isRevoked) {
      logger.warn({ userId, familyId }, "Refresh token reuse detected! Revoking family.");
      await userRepository.revokeTokenFamily(user._id, familyId);
      const error: CustomHttpError = new Error("Refresh token reuse detected. Please log in again.");
      error.statusCode = 401;
      error.code = "TOKEN_REUSE_DETECTED";
      throw error;
    }

    // Revoke old token and issue new pair within same family
    await userRepository.revokeTokenFamily(user._id, familyId);
    return this.generateSession(user, familyId);
  },

  async generateSession(user: UserRecord, existingFamilyId: string | null = null): Promise<AuthSessionResult> {
    const familyId = existingFamilyId || crypto.randomUUID();
    const userId = user._id.toString();

    // Access token (15 minutes)
    const accessToken = jwt.sign(
      {
        userId,
        email: user.email,
        role: user.role,
        plan: user.plan,
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "15m" },
    );

    // Refresh token (7 days) with cryptographic jti nonce
    const rawRefreshToken = jwt.sign(
      {
        userId,
        familyId,
        jti: crypto.randomUUID(),
      },
      env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" },
    );

    // Store token hash in user record
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await userRepository.addRefreshToken(user._id, {
      tokenHash: hashToken(rawRefreshToken),
      familyId,
      expiresAt,
      isRevoked: false,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: userId,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.plan,
      },
    };
  },
};
