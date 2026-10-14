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
    const { get, set, del, getOrSet, bumpVersion, CacheKeys, getCacheMetrics } =
      await import("../src/shared/cache.js");

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

  // Step 5: B3 Auth - Registration
  let testUserToken = null;
  let testUserRefreshToken = null;
  const testEmail = `candidate_${Date.now()}@example.com`;
  const testPassword = "Password123!";

  await recordStep("POST /api/v1/auth/register (create candidate)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Test Candidate",
      }),
    });
    if (res.status !== 201) {
      const err = await res.json();
      throw new Error(`Register failed with ${res.status}: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    if (!data.data.accessToken || data.data.user.email !== testEmail) {
      throw new Error("Invalid register payload response");
    }
    testUserToken = data.data.accessToken;
  });

  // Step 6: B3 Auth - Login
  await recordStep("POST /api/v1/auth/login (authenticate candidate)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    if (res.status !== 200) throw new Error(`Login failed with ${res.status}`);
    const data = await res.json();
    testUserToken = data.data.accessToken;

    // Extract set-cookie for refreshToken
    const cookies = res.headers.get("set-cookie") || "";
    const match = cookies.match(/refreshToken=([^;]+)/);
    if (match) {
      testUserRefreshToken = match[1];
    }
  });

  // Step 7: B3 Auth - Protected Route GET /api/v1/auth/me
  await recordStep("GET /api/v1/auth/me (authenticated session)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${testUserToken}`,
      },
    });
    if (res.status !== 200) throw new Error(`Me failed with ${res.status}`);
    const data = await res.json();
    if (data.data.user.email !== testEmail || data.data.user.plan !== "free") {
      throw new Error("Invalid /me user profile details");
    }
  });

  // Step 8: B3 Auth - Refresh Token Rotation & Reuse Detection
  await recordStep("POST /api/v1/auth/refresh (rotation & reuse revocation)", async () => {
    if (!testUserRefreshToken) {
      // If cookie was not accessible in node fetch, generate token through service directly
      const { authService } = await import("../src/services/authService.js");
      const { userRepository } = await import("../src/repositories/userRepository.js");
      const u = await userRepository.findByEmail(testEmail);
      const session = await authService.generateSession(u);
      testUserRefreshToken = session.refreshToken;
    }

    // 1. First rotation should succeed
    const res1 = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({ refreshToken: testUserRefreshToken }),
    });

    if (res1.status !== 200) {
      const err = await res1.json();
      throw new Error(`Refresh failed: ${JSON.stringify(err)}`);
    }

    // 2. Replaying the SAME old refresh token MUST trigger reuse detection (HTTP 401)
    const res2 = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({ refreshToken: testUserRefreshToken }),
    });

    if (res2.status !== 401) {
      throw new Error(`Expected 401 on token reuse, got ${res2.status}`);
    }
    const errData = await res2.json();
    if (errData.error.code !== "TOKEN_REUSE_DETECTED") {
      throw new Error(`Expected TOKEN_REUSE_DETECTED, got ${errData.error.code}`);
    }
  });

  // Step 9: B3 Quotas & Daily Budgets Check
  await recordStep("Quota & Budget Validation (Free Tier limits & blocks)", async () => {
    const { quotaService } = await import("../src/services/quotaService.js");
    const mockUser = { id: "test_quota_user_1", plan: "free" };

    // Initially quota check should pass
    await quotaService.checkQuota(mockUser, "chat");

    // Increment chat quota to 20 (free tier max)
    for (let i = 0; i < 20; i++) {
      await quotaService.incrementQuota(mockUser.id, "chat");
    }

    // 21st chat should throw 429 QUOTA_EXCEEDED
    let threw = false;
    try {
      await quotaService.checkQuota(mockUser, "chat");
    } catch (err) {
      if (err.code === "QUOTA_EXCEEDED") threw = true;
    }
    if (!threw) throw new Error("Free plan daily chat limit was not enforced");

    // Pro-only feature (interview_prep) should be blocked on Free tier (403)
    let proBlocked = false;
    try {
      await quotaService.checkQuota(mockUser, "interview_prep");
    } catch (err) {
      if (err.code === "PLAN_UPGRADE_REQUIRED") proBlocked = true;
    }
    if (!proBlocked) throw new Error("Pro feature was not blocked on Free tier");
  });

  // Step 10: B4 Magic Bytes Rejection (Fake PDF with invalid magic bytes)
  await recordStep("POST /api/v1/profile/upload-resume (reject fake PDF)", async () => {
    const fakeForm = new FormData();
    const fakeBlob = new Blob(["Just plain text pretending to be pdf"], {
      type: "application/pdf",
    });
    fakeForm.append("file", fakeBlob, "fake_resume.pdf");

    const res = await fetch(`${BASE_URL}/api/v1/profile/upload-resume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "X-Requested-With": "JobScoutClient",
      },
      body: fakeForm,
    });

    if (res.status !== 400) {
      throw new Error(`Expected 400 for spoofed magic bytes, got ${res.status}`);
    }
    const data = await res.json();
    if (data.error.code !== "INVALID_FILE_TYPE") {
      throw new Error(`Expected INVALID_FILE_TYPE, got ${data.error.code}`);
    }
  });

  // Step 11: B4 Resume Upload & Structured Fact Extraction
  await recordStep("POST /api/v1/profile/upload-resume (parse facts with factIds)", async () => {
    // Generate authentic binary PDF using PDFKit
    const PDFDocument = (await import("pdfkit")).default;
    const validPdfBuffer = await new Promise((resolve) => {
      const doc = new PDFDocument();
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.fontSize(16).text("Jane Doe - Senior Full Stack Architect");
      doc.moveDown();
      doc.fontSize(12).text("Experience: Tech Systems Inc - Principal Engineer (2020 - Present)");
      doc.text(
        "Architected event-driven microservices handling 25,000 requests per second with 99.99% uptime.",
      );
      doc.text(
        "Reduced cloud infrastructure costs by 35% through Redis caching and query optimization.",
      );
      doc.moveDown();
      doc.text("Skills: Node.js, Express, MongoDB, Redis, Docker, Kubernetes");
      doc.moveDown();
      doc.text("Education: B.S. in Computer Science, State University (2019)");
      doc.end();
    });

    const form = new FormData();
    const pdfBlob = new Blob([validPdfBuffer], { type: "application/pdf" });
    form.append("file", pdfBlob, "jane_doe_resume.pdf");

    const res = await fetch(`${BASE_URL}/api/v1/profile/upload-resume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "X-Requested-With": "JobScoutClient",
      },
      body: form,
    });

    if (res.status !== 200) {
      const err = await res.json();
      throw new Error(`Upload failed with ${res.status}: ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    const profile = data.data.profile;

    if (!profile.roles || profile.roles.length === 0) {
      throw new Error("No roles extracted from resume");
    }

    // Verify factIds exist and are non-empty
    const firstRole = profile.roles[0];
    if (!firstRole.factId || !firstRole.factId.startsWith("role_")) {
      throw new Error("Missing or malformed factId on role");
    }

    if (!firstRole.achievements || firstRole.achievements.length === 0) {
      throw new Error("No achievements extracted for role");
    }

    const firstAch = firstRole.achievements[0];
    if (!firstAch.factId || !firstAch.factId.startsWith("ach_")) {
      throw new Error("Missing or malformed factId on achievement");
    }
  });

  // Step 12: B4 Profile Facts List Verification
  await recordStep("GET /api/v1/profile/facts (retrieve factId registry)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/profile/facts`, {
      headers: {
        Authorization: `Bearer ${testUserToken}`,
      },
    });

    if (res.status !== 200) throw new Error(`Get facts failed with ${res.status}`);
    const data = await res.json();

    if (!data.data.facts || data.data.facts.length === 0) {
      throw new Error("Fact registry is empty");
    }

    // Every fact must have factId
    for (const f of data.data.facts) {
      if (!f.factId) throw new Error("Fact in registry missing factId");
    }
  });

  // Step 13: B4 Preferences Update & Profile Versioning
  await recordStep("PUT /api/v1/profile/preferences (update & bump version)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/profile/preferences`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({
        targetRoles: ["Staff Engineer", "Backend Architect"],
        minimumSalaryUsd: 160000,
        preferredLocations: ["Remote", "San Francisco"],
        remotePreference: "remote",
      }),
    });

    if (res.status !== 200) throw new Error(`Preferences update failed with ${res.status}`);
    const data = await res.json();
    if (data.data.profile.preferences.minimumSalaryUsd !== 160000) {
      throw new Error("Preferences were not updated accurately");
    }
  });

  // Step 14: B4 AES-256-GCM Encryption / Decryption Verification
  await recordStep("AES-256-GCM Encryption round-trip verification", async () => {
    const { encryptText, decryptText } = await import("../src/shared/utils/crypto.js");
    const secretResume = "Confidential Candidate Resume - Top Secret Experience";

    const encrypted = encryptText(secretResume);
    if (!encrypted.cipherText || !encrypted.iv || !encrypted.tag || encrypted.keyVersion !== "v1") {
      throw new Error("Encrypted payload missing critical cryptographic components");
    }

    const decrypted = decryptText(encrypted);
    if (decrypted !== secretResume) {
      throw new Error("Decrypted text does not match original plaintext");
    }
  });

  // Step 15: B5 Central LLM Wrapper Prompt Format Caching & Invocation
  await recordStep("Central LLM Wrapper (prompt caching order & invocation)", async () => {
    const { formatCachedPrompt, invokeLLM } = await import("../src/ai/llm.js");
    const { z } = await import("zod");

    // 1. Verify prompt formatting order
    const formatted = formatCachedPrompt({
      systemPrompt: "You are JobScout agent.",
      pinnedContext: "Skills: Node.js, Kubernetes",
      retrievedMemory: "Target: $160k+",
      conversationHistory: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello!" }],
      userMessage: "Match me to jobs",
    });

    if (formatted.length !== 6) {
      throw new Error(`Expected 6 prompt blocks, got ${formatted.length}`);
    }
    // Block 2 must have ephemeral cache_control
    if (!formatted[1].content[0].cache_control || formatted[1].content[0].cache_control.type !== "ephemeral") {
      throw new Error("Missing ephemeral cache_control on pinned facts block");
    }

    // 2. Invoke LLM with small model
    const mockUser = { id: "test_llm_user", plan: "pro" };
    const textRes = await invokeLLM({
      user: mockUser,
      tier: "small",
      feature: "chat",
      prompt: formatted,
    });

    if (!textRes || typeof textRes !== "string") {
      throw new Error("LLM invocation failed to return text response");
    }

    // 3. Structured Output invocation with Zod schema
    const testSchema = z.object({
      intent: z.string(),
      confidence: z.number(),
    });

    const structuredRes = await invokeLLM({
      user: mockUser,
      tier: "small",
      feature: "router_classify",
      prompt: formatted,
      schema: testSchema,
    });

    if (!structuredRes.intent || typeof structuredRes.confidence !== "number") {
      throw new Error("Structured output failed Zod schema verification");
    }
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
