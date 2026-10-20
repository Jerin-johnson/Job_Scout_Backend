import "reflect-metadata";
// Lock tests to local services before dotenv/config is imported by application modules.
if (!process.env.NODE_OPTIONS?.includes("--import tsx")) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --import tsx`.trim();
}
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const composeHosts = new Set(["mongo", "redis"]);
function requireLoopback(name, fallback) {
  const value = process.env[name];
  if (!value) {
    process.env[name] = fallback;
    return;
  }
  let host;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    throw new Error(
      `${name} must be a valid loopback URL for tests; its value is intentionally not shown.`,
    );
  }
  if (
    !loopbackHosts.has(host) &&
    !(process.env.JOBSCOUT_LOCAL_COMPOSE === "1" && composeHosts.has(host))
  ) {
    throw new Error(
      `${name} must point to loopback for tests; hosted services are forbidden and the value is intentionally not shown.`,
    );
  }
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Tests cannot run with NODE_ENV=production.");
}
process.env.NODE_ENV = "test";
requireLoopback("MONGODB_URI", "mongodb://127.0.0.1:27017/jobscout_test");
requireLoopback("REDIS_URL", "redis://127.0.0.1:6379");
process.env.AI_ALLOW_MOCKS ||= "true";
process.env.MONGOMS_LAUNCH_TIMEOUT ||= "60000";
if (process.env.SMOKE_ALLOW_LIVE_AI !== "true") {
  process.env.GROQ_API_KEY ||= "dummy_groq_key_for_test";
  process.env.GEMINI_API_KEY ||= "dummy_gemini_key_for_test";
  process.env.ANTHROPIC_API_KEY ||= "dummy_anthropic_key_for_dev";
  process.env.OPENAI_API_KEY ||= "dummy_openai_key";
  process.env.VOYAGE_API_KEY ||= "";
  process.env.S3_ACCESS_KEY_ID ||= "dummy_s3_key";
  process.env.S3_SECRET_ACCESS_KEY ||= "dummy_s3_secret";
  process.env.RESEND_API_KEY ||= "re_dummy_key";
}
