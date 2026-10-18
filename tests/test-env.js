// Lock tests to local services before dotenv/config is imported by application modules.
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
    throw new Error(`${name} must be a valid loopback URL for tests; its value is intentionally not shown.`);
  }
  if (!loopbackHosts.has(host) && !(process.env.JOBSCOUT_LOCAL_COMPOSE === "1" && composeHosts.has(host))) {
    throw new Error(`${name} must point to loopback for tests; hosted services are forbidden and the value is intentionally not shown.`);
  }
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Tests cannot run with NODE_ENV=production.");
}
process.env.NODE_ENV = "test";
requireLoopback("MONGODB_URI", "mongodb://127.0.0.1:27017/jobscout_test");
requireLoopback("REDIS_URL", "redis://127.0.0.1:6379");
process.env.AI_ALLOW_MOCKS ||= "true";
