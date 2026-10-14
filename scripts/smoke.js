import { createApp } from "../src/app.js";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4001";
let server = null;

const results = [];

async function recordStep(name, fn) {
  const start = performance.now();
  try {
    await fn();
    const duration = Math.round(performance.now() - start);
    results.push({ name, status: "PASS", duration });
    console.log(`  \x1b[32m✔ PASS\x1b[0m ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    results.push({ name, status: "FAIL", duration, error: err.message });
    console.error(`  \x1b[31m✖ FAIL\x1b[0m ${name} (${duration}ms): ${err.message}`);
  }
}

async function startServerIfNeeded() {
  try {
    const res = await fetch(`${BASE_URL}/health/live`);
    if (res.ok) return;
  } catch {
    // Server not running, launch ephemeral instance for smoke tests
    const app = createApp();
    const url = new URL(BASE_URL);
    await new Promise((resolve) => {
      server = app.listen(Number(url.port) || 4001, url.hostname, resolve);
    });
  }
}

async function run() {
  console.log("\n========================================================");
  console.log(`🚀 Starting JobScout Backend Smoke Verification [${BASE_URL}]`);
  console.log("========================================================\n");

  await startServerIfNeeded();

  // Step 1: Health Liveness
  await recordStep("GET /health/live (process up)", async () => {
    const res = await fetch(`${BASE_URL}/health/live`);
    if (!res.ok) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error("Status was not ok");
  });

  // Step 2: Health Readiness (200 or 503 with dependency report)
  await recordStep("GET /health/ready (dependency health)", async () => {
    const res = await fetch(`${BASE_URL}/health/ready`);
    const data = await res.json();
    if (!data.status || !data.dependencies) {
      throw new Error("Missing dependencies report in /health/ready");
    }
  });

  // Step 3: Security & Error Format Verification (404 returns structured error)
  await recordStep("GET /unknown-route (returns structured error & requestId)", async () => {
    const res = await fetch(`${BASE_URL}/unknown-route`, {
      headers: { "X-Request-Id": "smoke-test-req-001" },
    });
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    const data = await res.json();
    if (
      !data.error ||
      data.error.code !== "NOT_FOUND" ||
      data.error.requestId !== "smoke-test-req-001"
    ) {
      throw new Error("Malformed error response shape");
    }
  });

  // Step 4: B2 Shared Cache get/set/del & getOrSet & compression
  await recordStep("Shared Cache get/set/del & single-flight getOrSet", async () => {
    const { get, set, del, getOrSet, bumpVersion, CacheKeys, getCacheMetrics } = await import(
      "../src/shared/cache.js"
    );

    const testKey = CacheKeys.exactQuery("test-hash-12345");
    await del(testKey);

    // Test direct set and get
    await set(testKey, { direct: true }, 60);
    const directVal = await get(testKey);
    if (!directVal || !directVal.direct) throw new Error("Direct set failed");
    await del(testKey);

    // Test getOrSet
    let computeCalls = 0;
    const val1 = await getOrSet(
      testKey,
      async () => {
        computeCalls++;
        return { msg: "computed-value", largeData: "X".repeat(3000) };
      },
      60,
    );

    if (val1.msg !== "computed-value" || computeCalls !== 1) {
      throw new Error("getOrSet did not compute value");
    }

    // Second call should hit cache without calling computeFn
    const val2 = await getOrSet(
      testKey,
      async () => {
        computeCalls++;
        return { msg: "should-not-be-called" };
      },
      60,
    );

    if (val2.msg !== "computed-value" || computeCalls !== 1) {
      throw new Error("getOrSet called computeFn on cached value");
    }

    // Version bump invalidation
    const ver1 = await bumpVersion("usr_123", "profile");
    const ver2 = await bumpVersion("usr_123", "profile");
    if (ver2 <= ver1) throw new Error("Version did not increment on bumpVersion");

    // Metrics tracking
    const metrics = getCacheMetrics();
    if (metrics.hits < 1 || metrics.misses < 1) {
      throw new Error("Cache metrics did not record hit/miss");
    }

    await del(testKey);
  });

  // Clean up server if we started it
  if (server) {
    server.close();
  }

  // Summary
  console.log("\n--------------------------------------------------------");
  const failed = results.filter((r) => r.status === "FAIL");
  const totalDuration = results.reduce((acc, r) => acc + r.duration, 0);

  if (failed.length === 0) {
    console.log(
      `\x1b[32mALL SMOKE CHECKS PASSED\x1b[0m (${results.length} checks in ${totalDuration}ms)`,
    );
    process.exit(0);
  } else {
    console.error(
      `\x1b[31mSMOKE CHECKS FAILED: ${failed.length} / ${results.length} failed\x1b[0m`,
    );
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal error running smoke tests:", err);
  if (server) server.close();
  process.exit(1);
});
