export const RESUME_AI_CONSENT_VERSION = "resume-ai-processing-v1";

export async function requireResumeAiConsent(userId, userRepository) {
  const user = await userRepository.findById(userId);
  if (user?.resumeAiConsent?.version === RESUME_AI_CONSENT_VERSION && user.resumeAiConsent.acceptedAt) return user;
  const error = new Error("Please review and accept AI resume processing before using resume matching.");
  error.statusCode = 403;
  error.code = "RESUME_AI_CONSENT_REQUIRED";
  throw error;
}
