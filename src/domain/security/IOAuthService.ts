export interface OAuthProfile {
  email: string;
  sub: string;
  name?: string;
}

export interface IOAuthService {
  verifyGoogleToken(idToken: string): Promise<OAuthProfile>;
}
