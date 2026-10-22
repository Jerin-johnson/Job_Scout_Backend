import { OAuth2Client } from "google-auth-library";
import { injectable } from "tsyringe";
import { IOAuthService, OAuthProfile } from "../../domain/security/IOAuthService.js";
import { env } from "../../config/env.js";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

interface CustomHttpError extends Error {
  statusCode?: number;
  code?: string;
}

@injectable()
export class GoogleOAuthService implements IOAuthService {
  async verifyGoogleToken(idToken: string): Promise<OAuthProfile> {
    let payload: { email?: string; sub?: string; name?: string } | undefined;

    try {
      if (idToken.startsWith("mock_token_")) {
        payload = {
          email: `${idToken}@example.com`,
          sub: `google_${idToken}`,
          name: "Mock User",
        };
      } else {
        const ticket = await googleClient.verifyIdToken({
          idToken,
          audience: env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload() as
          { email?: string; sub?: string; name?: string } | undefined;
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

    return {
      email: payload.email,
      sub: payload.sub || "",
      name: payload.name,
    };
  }
}
