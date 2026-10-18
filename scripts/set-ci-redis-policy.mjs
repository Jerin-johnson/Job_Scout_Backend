import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { lazyConnect: true });
try {
  await redis.connect();
  const result = await redis.config("SET", "maxmemory-policy", "noeviction");
  if (result !== "OK") throw new Error("Redis refused the noeviction test policy.");
} finally {
  redis.disconnect();
}
console.log("CI test Redis configured with maxmemory-policy noeviction.");
