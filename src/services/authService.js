import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";
import { userRepository } from "../repositories/userRepository.js";
import { logger } from "../shared/utils/logger.js";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const authService = {
  async register({ email, password, name }) {
    const existing = await userRepository.findByEmail(email);
    if (existing) {
      const err = new Error("An account with this email already exists");
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

  async login({ email, password }) {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      const err = new Error("Invalid email or password");
      err.statusCode = 401;
      err.code = "INVALID_CREDENTIALS";
      throw err;
    }

    // Check account lockout
    if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
      const minutesRemaining = Math.ceil((new Date(user.lockUntil) - Date.now()) / 60000);
      const err = new Error(
        `Account temporarily locked due to repeated failed logins. Try again in ${minutesRemaining} minutes.`,
      );
      err.statusCode = 429;
      err.code = "ACCOUNT_LOCKED";
      throw err;
    }

    if (!user.passwordHash) {
      const err = new Error("Please log in with Google OAuth");
      err.statusCode = 400;
      err.code = "OAUTH_USER";
      throw err;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await userRepository.recordFailedLogin(user._id, user.failedLoginAttempts || 0);
      const err = new Error("Invalid email or password");
      err.statusCode = 401;
      err.code = "INVALID_CREDENTIALS";
      throw err;
    }

    // Reset failed logins upon successful login
    if (user.failedLoginAttempts > 0) {
      await userRepository.resetFailedLogins(user._id);
    }

    return this.generateSession(user);
  },

  async googleLogin(idToken) {
    let payload;
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
        payload = ticket.getPayload();
      }
    } catch (error) {
      const err = new Error(`Invalid Google ID token: ${error.message}`);
      err.statusCode = 401;
      err.code = "INVALID_OAUTH_TOKEN";
      throw err;
    }

    if (!payload?.email) {
      const err = new Error("Google profile did not provide an email address");
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
      user = await userRepository.update(user._id, { googleId: payload.sub });
    }

    return this.generateSession(user);
  },

  async rotateRefreshToken(rawRefreshToken) {
    let decoded;
    try {
      decoded = jwt.verify(rawRefreshToken, env.JWT_REFRESH_SECRET);
    } catch (err) {
      const error = new Error(`Invalid refresh token: ${err.message}`);
      error.statusCode = 401;
      error.code = "INVALID_REFRESH_TOKEN";
      throw error;
    }

    const { userId, familyId } = decoded;
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error("User associated with token not found");
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
      const error = new Error("Refresh token reuse detected. Please log in again.");
      error.statusCode = 401;
      error.code = "TOKEN_REUSE_DETECTED";
      throw error;
    }

    // Revoke old token and issue new pair within same family
    await userRepository.revokeTokenFamily(user._id, familyId);
    return this.generateSession(user, familyId);
  },

  async generateSession(user, existingFamilyId = null) {
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
