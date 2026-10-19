import zlib from "zlib";
import { promisify } from "util";
import { getRedisClient, isRedisReady } from "../config/redis.js";
import { logger } from "./utils/logger.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Namespace constant
export const CACHE_NAMESPACE = "js:v1:";

// TTL Constants in seconds
export const TTL = {
  RESPONSE: 60, // 30-120s
  PINNED_MEMORY: 86400, // 24h
  SESSION: 86400, // 24h
  EXACT_QUERY: 86400, // 24h
  JD_PARSE: 2592000, // 30d
  EMBEDDING: 7776000, // 90d
  COMPANY_INFO: 604800, // 7d
  RESUME_PARSE: 2592000, // 30d
  BOARD: 60, // 60s
  LOCK: 15, // 10-30s
  VERSION: 2592000, // 30d
  SHORT: 300, // 5m
} as const;

// Hit / Miss telemetry metrics
const metrics: {
  hits: number;
  misses: number;
  errors: number;
  bypasses: number;
  layers: Record<string, { hits: number; misses: number }>;
} = {
  hits: 0,
  misses: 0,
  errors: 0,
  bypasses: 0,
  layers: {
    response: { hits: 0, misses: 0 },
    memory: { hits: 0, misses: 0 },
    session: { hits: 0, misses: 0 },
    exact: { hits: 0, misses: 0 },
    jd: { hits: 0, misses: 0 },
    embedding: { hits: 0, misses: 0 },
    company: { hits: 0, misses: 0 },
    other: { hits: 0, misses: 0 },
  },
};

function recordMetric(layer: string, type: "hit" | "miss"): void {
  if (type === "hit") {
    metrics.hits++;
    if (metrics.layers[layer]) metrics.layers[layer].hits++;
    else metrics.layers.other.hits++;
  } else if (type === "miss") {
    metrics.misses++;
    if (metrics.layers[layer]) metrics.layers[layer].misses++;
    else metrics.layers.other.misses++;
  }
}

/**
 * Typed cache key builders
 */
export const CacheKeys = {
  version: (userId: string, scope: string) => `${CACHE_NAMESPACE}ver:${userId}:${scope}`,
  response: (userId: string, resource: string, ver: string | number) => `${CACHE_NAMESPACE}resp:${userId}:${resource}:v${ver}`,
  pinnedMemory: (userId: string, ver: string | number) => `${CACHE_NAMESPACE}mem:pinned:${userId}:v${ver}`,
  session: (userId: string, threadId: string) => `${CACHE_NAMESPACE}sess:${userId}:${threadId}`,
  interviewSession: (userId: string, interviewId: string) => `${CACHE_NAMESPACE}interview:${userId}:${interviewId}`,
  exactQuery: (sha256: string) => `${CACHE_NAMESPACE}exact:${sha256}`,
  jobDescription: (hash: string) => `${CACHE_NAMESPACE}jd:${hash}`,
  embedding: (hash: string, provider: string = "legacy", model: string = "unknown", dimension: string | number = "unknown") =>
    `${CACHE_NAMESPACE}emb:${provider}:${model}:${dimension}:${hash}`,
  company: (slug: string) => `${CACHE_NAMESPACE}co:${slug}`,
  jobDemand: () => `${CACHE_NAMESPACE}job-demand:v1`,
  jobDemandVersion: (catalogVersion: number = 1) =>
    `${CACHE_NAMESPACE}job-demand:catalog-v${catalogVersion}`,
  catalogTotal: (catalogVersion: number = 1, filterSig: string = "all") =>
    `${CACHE_NAMESPACE}job-catalog:total:v${catalogVersion}:${filterSig}`,
  catalogFacets: (catalogVersion: number = 1, sourcesSig: string = "all") =>
    `${CACHE_NAMESPACE}job-catalog:facets:v${catalogVersion}:${sourcesSig}`,
  resumeParse: (fileHash: string) => `${CACHE_NAMESPACE}rp:${fileHash}`,
  board: (userId: string, ver: string | number) => `${CACHE_NAMESPACE}board:${userId}:v${ver}`,
  lock: (key: string) => `${CACHE_NAMESPACE}lock:${key}`,
};

/**
 * Detect cache layer from key
 */
function detectLayer(key: string): string {
  if (key.includes("resp:")) return "response";
  if (key.includes("mem:pinned:")) return "memory";
  if (key.includes("sess:")) return "session";
  if (key.includes("exact:")) return "exact";
  if (key.includes("jd:")) return "jd";
  if (key.includes("emb:")) return "embedding";
  if (key.includes("co:")) return "company";
  return "other";
}

/**
 * In-memory fallback cache when Redis is disconnected or in test environments
 */
const inMemoryCache = new Map<string, unknown>();
const inMemoryExpirations = new Map<string, number>();

function cleanInMemoryExpired(key: string): boolean {
  const exp = inMemoryExpirations.get(key);
  if (exp && Date.now() > exp) {
    inMemoryCache.delete(key);
    inMemoryExpirations.delete(key);
    return true;
  }
  return false;
}

/**
 * Get value from cache with automatic decompression if compressed
 */
export async function get<T = unknown>(key: string): Promise<T | null> {
  const layer = detectLayer(key);

  if (!isRedisReady()) {
    cleanInMemoryExpired(key);
    const inMemVal = inMemoryCache.get(key);
    if (inMemVal !== undefined) {
      recordMetric(layer, "hit");
      return inMemVal as T;
    }
    recordMetric(layer, "miss");
    return null;
  }

  try {
    const redis = getRedisClient();
    const raw = await redis.getBuffer(key);

    if (!raw) {
      recordMetric(layer, "miss");
      return null;
    }

    recordMetric(layer, "hit");

    // Check compression flag prefix: 0x1f 0x8b (Gzip magic header)
    let jsonStr: string;
    if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
      const decompressed = await gunzip(raw);
      jsonStr = decompressed.toString("utf8");
    } else {
      jsonStr = raw.toString("utf8");
    }

    return JSON.parse(jsonStr) as T;
  } catch (err: unknown) {
    metrics.errors++;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, key }, "Cache GET failed; failing open");
    return null;
  }
}

/**
 * Set value in cache with optional compression (> 2KB)
 */
export async function set<T = unknown>(key: string, value: T, ttlSeconds: number = TTL.SHORT): Promise<boolean> {
  const serialized = JSON.stringify(value);

  if (!isRedisReady()) {
    inMemoryCache.set(key, value);
    if (ttlSeconds > 0) {
      inMemoryExpirations.set(key, Date.now() + ttlSeconds * 1000);
    }
    return true;
  }

  try {
    const redis = getRedisClient();

    // Compress payloads larger than 2KB (2048 bytes)
    if (serialized.length > 2048) {
      const compressed = await gzip(Buffer.from(serialized, "utf8"));
      await redis.set(key, compressed, "EX", ttlSeconds);
    } else {
      await redis.set(key, serialized, "EX", ttlSeconds);
    }
    return true;
  } catch (err: unknown) {
    metrics.errors++;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, key }, "Cache SET failed; failing open");
    return false;
  }
}

/**
 * Delete key from cache
 */
export async function del(key: string): Promise<boolean> {
  inMemoryCache.delete(key);
  inMemoryExpirations.delete(key);

  if (!isRedisReady()) return true;

  try {
    const redis = getRedisClient();
    await redis.del(key);
    return true;
  } catch (err: unknown) {
    metrics.errors++;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, key }, "Cache DEL failed; failing open");
    return false;
  }
}

/**
 * Bump version number for scope invalidation
 * Returns new version number
 */
export async function bumpVersion(userId: string, scope: string): Promise<number> {
  const verKey = CacheKeys.version(userId, scope);

  if (!isRedisReady()) {
    const current = ((inMemoryCache.get(verKey) as number | undefined) || 0) + 1;
    inMemoryCache.set(verKey, current);
    return current;
  }

  try {
    const redis = getRedisClient();
    const newVer = await redis.incr(verKey);
    await redis.expire(verKey, TTL.VERSION);
    return newVer;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message, verKey },
      "Cache bumpVersion failed; falling back to timestamp",
    );
    return Date.now();
  }
}

/**
 * Get current version number for scope
 */
export async function getVersion(userId: string, scope: string): Promise<number> {
  const verKey = CacheKeys.version(userId, scope);

  if (!isRedisReady()) {
    return (inMemoryCache.get(verKey) as number | undefined) || 1;
  }

  try {
    const redis = getRedisClient();
    const ver = await redis.get(verKey);
    return ver ? parseInt(ver, 10) : 1;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, verKey }, "Cache getVersion failed; defaulting to 1");
    return 1;
  }
}

/**
 * Acquire single-flight distributed lock with SET NX PX
 */
export async function acquireLock(lockKey: string, ttlMs: number = 15000): Promise<string | null> {
  const lockToken = Math.random().toString(36).substring(2);

  if (!isRedisReady()) {
    return lockToken;
  }

  try {
    const redis = getRedisClient();
    const acquired = await redis.set(lockKey, lockToken, "PX", ttlMs, "NX");
    return acquired === "OK" ? lockToken : null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, lockKey }, "Acquire lock failed; failing open");
    return lockToken;
  }
}

/**
 * Release distributed lock
 */
export async function releaseLock(lockKey: string, lockToken: string): Promise<boolean> {
  if (!isRedisReady()) return true;

  try {
    const redis = getRedisClient();
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(luaScript, 1, lockKey, lockToken);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, lockKey }, "Release lock failed; ignored");
    return false;
  }
}

/**
 * Get cached value or compute and set, protected by single-flight lock
 */
export async function getOrSet<T>(key: string, computeFn: () => Promise<T>, ttlSeconds: number = TTL.SHORT): Promise<T> {
  // 1. Try reading cache first
  const cached = await get<T>(key);
  if (cached !== null) {
    return cached;
  }

  // 2. Lock to prevent cache stampede / dog-piling
  const lockKey = CacheKeys.lock(key);
  let token = await acquireLock(lockKey, 10000);

  // If lock not acquired, wait up to 3 times with jitter
  if (!token) {
    for (let i = 0; i < 3; i++) {
      const jitter = Math.floor(Math.random() * 50) + 50;
      await new Promise((res) => setTimeout(res, jitter));
      const retryCached = await get<T>(key);
      if (retryCached !== null) return retryCached;
    }
    // Attempt lock one final time
    token = await acquireLock(lockKey, 10000);
  }

  try {
    // Re-check once lock is held
    const doubleCheck = await get<T>(key);
    if (doubleCheck !== null) return doubleCheck;

    // 3. Compute fresh value
    const freshValue = await computeFn();

    // 4. Cache fresh value
    if (freshValue !== undefined && freshValue !== null) {
      await set<T>(key, freshValue, ttlSeconds);
    }

    return freshValue;
  } finally {
    if (token) {
      await releaseLock(lockKey, token);
    }
  }
}

/**
 * Get cache metrics for /admin/metrics endpoint
 */
export function getCacheMetrics(): {
  hits: number;
  misses: number;
  errors: number;
  bypasses: number;
  layers: Record<string, { hits: number; misses: number }>;
  totalRequests: number;
  hitRatio: number;
} {
  const total = metrics.hits + metrics.misses;
  const hitRatio = total > 0 ? (metrics.hits / total).toFixed(4) : "0.0000";

  return {
    ...metrics,
    totalRequests: total,
    hitRatio: parseFloat(hitRatio),
  };
}
