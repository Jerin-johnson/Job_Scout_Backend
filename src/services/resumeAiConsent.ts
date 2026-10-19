export const RESUME_AI_CONSENT_VERSION = "resume-ai-processing-v1";

export interface UserWithConsent {
  _id?: unknown;
  id?: unknown;
  resumeAiConsent?: {
    version?: string;
    acceptedAt?: Date | string | null;
  };
  [key: string]: unknown;
}

export interface UserRepositoryLike {
  findById(userId: string): Promise<UserWithConsent | null>;
}

export interface ConsentError extends Error {
  statusCode?: number;
  code?: string;
}

export async function requireResumeAiConsent<T extends UserWithConsent = UserWithConsent>(
  userId: string,
  userRepository: UserRepositoryLike,
): Promise<T> {
  const user = (await userRepository.findById(userId)) as T | null;
  if (user?.resumeAiConsent?.version === RESUME_AI_CONSENT_VERSION && user.resumeAiConsent.acceptedAt) {
    return user;
  }
  const error: ConsentError = new Error("Please review and accept AI resume processing before using resume matching.");
  error.statusCode = 403;
  error.code = "RESUME_AI_CONSENT_REQUIRED";
  throw error;
}
