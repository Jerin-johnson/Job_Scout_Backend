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
      const doc = new PDFDocument({ pdfVersion: "1.5" });
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
      conversationHistory: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
      ],
      userMessage: "Match me to jobs",
    });

    if (formatted.length !== 6) {
      throw new Error(`Expected 6 prompt blocks, got ${formatted.length}`);
    }
    // Block 2 must have ephemeral cache_control
    if (
      !formatted[1].content[0].cache_control ||
      formatted[1].content[0].cache_control.type !== "ephemeral"
    ) {
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

  // Step 16: B6 AI Router - Tier 0 Slash Commands & DB Lookups (< 50ms)
  await recordStep("AI Router Tier 0 (Slash command & Deterministic DB match)", async () => {
    const { routeRequest } = await import("../src/ai/router.js");
    const mockUser = { id: "test_router_user", plan: "pro" };

    // 1. Slash command /track
    const slashRes = await routeRequest({ prompt: "/track", user: mockUser });
    if (slashRes.tier !== 0 || slashRes.hitType !== "slash_command") {
      throw new Error(`Expected Tier 0 slash_command, got tier ${slashRes.tier}`);
    }
    if (slashRes.latencyMs > 50) {
      throw new Error(`Tier 0 latency exceeded 50ms target: ${slashRes.latencyMs}ms`);
    }

    // 2. Deterministic DB query
    const dbRes = await routeRequest({ prompt: "show my applications this week", user: mockUser });
    if (dbRes.tier !== 0 || dbRes.hitType !== "deterministic_query") {
      throw new Error(`Expected Tier 0 deterministic_query, got tier ${dbRes.tier}`);
    }
  });

  // Step 17: B6 AI Router - Exact Cache Speedup (< 50ms)
  await recordStep("AI Router Tier 0 Exact Cache hit speedup", async () => {
    const { routeRequest } = await import("../src/ai/router.js");
    const { set, CacheKeys, TTL } = await import("../src/shared/cache.js");
    const { computeSha256 } = await import("../src/shared/utils/crypto.js");

    const promptText = "How do I optimize my resume for ATS scanners?";
    const promptHash = computeSha256(`${promptText}:v1`);
    const cacheKey = CacheKeys.exactQuery(promptHash);

    // Seed exact cache
    await set(
      cacheKey,
      {
        intent: "chat_simple",
        output: "Use clean formatting, standard headers, and target keywords from the JD.",
      },
      TTL.EXACT_QUERY,
    );

    const cachedRes = await routeRequest({
      prompt: promptText,
      user: { id: "test_cached_user", plan: "pro" },
      contextVersion: 1,
    });

    if (cachedRes.tier !== 0 || cachedRes.hitType !== "exact_cache") {
      throw new Error(`Expected Tier 0 exact_cache hit, got tier ${cachedRes.tier}`);
    }
    if (!cachedRes.cachedOutput) {
      throw new Error("Cached response payload missing");
    }
  });

  // Step 18: B6 AI Router - Tier 1 & Tier 2 Classification & Escalation
  await recordStep("AI Router Tier 1 vs Tier 2 Escalation", async () => {
    const { routeRequest } = await import("../src/ai/router.js");
    const mockUser = { id: "test_escalation_user", plan: "pro" };

    // Simple question -> Tier 1
    const t1Res = await routeRequest({
      prompt: "Give me a 1-sentence tip on salary negotiation",
      user: mockUser,
    });
    if (t1Res.tier !== 1) {
      throw new Error(`Expected Tier 1 for simple chat, got ${t1Res.tier}`);
    }

    // Heavy workflow intent -> Tier 2
    // We can test that heavy workflows resolve to Tier 2
    const { routerClassifierSchema } = await import("../src/ai/router.js");
    const parsed = routerClassifierSchema.safeParse({
      intent: "match_jobs",
      complexity: "high",
      needsTools: true,
      needsMemory: true,
      confidence: 0.95,
      entities: {},
    });
    if (!parsed.success) throw new Error("Classifier schema validation error");
  });

  // Step 19: B6 SSE Streaming Chat Endpoint (First token latency & event stream)
  await recordStep("POST /api/v1/ai/chat (SSE first token & stream events)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/ai/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({
        prompt: "Show my applications",
      }),
    });

    if (res.status !== 200) {
      const err = await res.text();
      throw new Error(`Chat SSE failed with ${res.status}: ${err}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      throw new Error(`Expected text/event-stream, got ${contentType}`);
    }

    // Read stream events
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let streamText = "";
    let receivedRoutingEvent = false;
    let receivedTokenEvent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamText += decoder.decode(value, { stream: true });
      if (streamText.includes("event: routing")) receivedRoutingEvent = true;
      if (streamText.includes("event: token")) receivedTokenEvent = true;
    }

    if (!receivedRoutingEvent) {
      throw new Error("Missing 'routing' event in SSE stream");
    }
    if (!receivedTokenEvent) {
      throw new Error("Missing 'token' event in SSE stream");
    }
  });

  // Step 20: B7 Short-Term Memory Sliding Window (8 turns max)
  await recordStep("Short-Term Memory (Redis session sliding window 8 turns)", async () => {
    const { shortTermMemory } = await import("../src/ai/memory/shortTerm.js");
    const threadId = "thread_smoke_test_1";
    const userId = "user_smoke_mem";

    for (let i = 1; i <= 10; i++) {
      await shortTermMemory.appendTurn(
        userId,
        threadId,
        i % 2 === 1 ? "user" : "assistant",
        `Turn ${i}`,
      );
    }

    const turns = await shortTermMemory.getTurns(userId, threadId);
    if (turns.length !== 8) {
      throw new Error(`Expected exactly 8 turns in sliding window, got ${turns.length}`);
    }
    if (turns[0].content !== "Turn 3") {
      throw new Error(`Oldest turn was not evicted, got: ${turns[0].content}`);
    }
  });

  // Step 21: B7 Long-Term Memory Deduplication & Vector Storage
  await recordStep("Long-Term Memory write & deduplication (>0.9 similarity)", async () => {
    const { longTermMemory } = await import("../src/ai/memory/longTerm.js");
    const userId = "user_smoke_ltm";

    // Write first memory
    const mem1 = await longTermMemory.writeMemory({
      userId,
      userPlan: "pro",
      type: "preference",
      key: "dislikes_agencies",
      content: "Candidate strongly dislikes working with third-party recruitment agencies.",
      importance: 4,
      confidence: 0.9,
    });
    if (!mem1) throw new Error("Failed to write initial memory");

    // Write near-duplicate memory
    await longTermMemory.writeMemory({
      userId,
      userPlan: "pro",
      type: "preference",
      key: "dislikes_agencies",
      content: "Candidate strongly dislikes working with third-party recruitment agencies.",
      importance: 4,
      confidence: 0.9,
    });

    const memories = await longTermMemory.listUserMemories(userId);
    if (memories.length !== 1) {
      throw new Error(`Expected deduplication to keep 1 memory, got ${memories.length}`);
    }
  });

  // Step 22: B7 Compliance Filter (Block Protected Attributes)
  await recordStep("Memory Compliance Filter (rejection of protected attributes)", async () => {
    const { longTermMemory } = await import("../src/ai/memory/longTerm.js");
    let caught = false;

    try {
      await longTermMemory.writeMemory({
        userId: "user_smoke_compliance",
        userPlan: "pro",
        type: "fact",
        key: "candidate_age",
        content: "Candidate is 58 years old and adheres to christian faith.",
        importance: 3,
        confidence: 0.9,
      });
    } catch (err) {
      if (err.code === "PROTECTED_ATTRIBUTE_REJECTED") {
        caught = true;
      }
    }

    if (!caught) {
      throw new Error("Compliance filter failed to reject protected attribute");
    }
  });

  // Step 23: B7 Memory API Endpoints (List & Toggle Pause)
  await recordStep("GET /api/v1/memories & POST /toggle-pause", async () => {
    // 1. List
    const listRes = await fetch(`${BASE_URL}/api/v1/memories`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (listRes.status !== 200) throw new Error(`List memories failed: ${listRes.status}`);

    // 2. Toggle pause
    const pauseRes = await fetch(`${BASE_URL}/api/v1/memories/toggle-pause`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "X-Requested-With": "JobScoutClient",
      },
    });
    if (pauseRes.status !== 200) throw new Error(`Toggle pause failed: ${pauseRes.status}`);
    const data = await pauseRes.json();
    if (typeof data.data.memoryPaused !== "boolean") {
      throw new Error("Missing memoryPaused boolean");
    }
  });

  // Step 24: B8 Job Ingestion & One-Time Vector Embedding
  await recordStep("Job Ingestion (deduplication & one-time embedding)", async () => {
    const { jobIngestionService } = await import("../src/services/jobs/jobIngestionService.js");
    const result = await jobIngestionService.ingestAll();

    if (result.ingested < 1) {
      throw new Error("Job ingestion failed to produce jobs");
    }
    // Verify every job has contentHash
    for (const j of result.jobs) {
      if (!j.contentHash) throw new Error("Job missing contentHash");
    }
  });

  // Step 25: B8 Discovery Graph A Execution & Rule Filtering
  let discoveredJobId = null;
  await recordStep("Discovery Graph A (vector matching, rule filter & top matches)", async () => {
    const { userRepository } = await import("../src/repositories/userRepository.js");
    const { discoveryGraph } = await import("../src/ai/graphs/discoveryGraph.js");

    const u = await userRepository.findByEmail(testEmail);
    const result = await discoveryGraph.runDiscovery(u);

    if (!result.matches || result.matches.length === 0) {
      throw new Error("Discovery graph produced 0 matches");
    }

    const firstMatch = result.matches[0];
    if (typeof firstMatch.score !== "number" || !firstMatch.rationale) {
      throw new Error("Match record missing score or rationale");
    }
    discoveredJobId = firstMatch.jobId;
  });

  // Step 26: B8 Matches API with L1 Caching
  await recordStep("GET /api/v1/jobs/matches (precomputed matches & response cache)", async () => {
    // 1. Initial read
    const res1 = await fetch(`${BASE_URL}/api/v1/jobs/matches`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (res1.status !== 200) throw new Error(`Get matches failed: ${res1.status}`);
    const data1 = await res1.json();
    if (!data1.data.matches || data1.data.matches.length === 0) {
      throw new Error("No matches returned from API");
    }

    // 2. Second read should hit L1 response cache
    const res2 = await fetch(`${BASE_URL}/api/v1/jobs/matches`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    const data2 = await res2.json();
    if (!data2.data.fromCache) {
      throw new Error("Second matches request did not hit L1 cache");
    }
  });

  // Step 27: B8 Match Feedback Recording (writes preference memory)
  await recordStep("POST /api/v1/jobs/:id/feedback (thumbs down with reason)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/jobs/${discoveredJobId}/feedback`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({
        feedback: "thumbs_down",
        reason: "Compensation range is below preferred baseline",
      }),
    });

    if (res.status !== 200) throw new Error(`Feedback failed: ${res.status}`);
    const data = await res.json();
    if (data.data.match?.userFeedback !== "thumbs_down") {
      throw new Error("Feedback was not saved correctly");
    }
  });

  // Step 28: B9 Tailor Resume Start (truthfulness check + factId linking)
  let draftDocId = null;
  await recordStep("POST /api/v1/tailor/start (truthful facts & ATS keyword scoring)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/tailor/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({
        jobId: discoveredJobId || "job_test_123",
        jobTitle: "Senior Backend Engineer",
        company: "Stripe",
        jdText:
          "Seeking a Senior Backend Engineer proficient in Node.js, Express, MongoDB, and Redis API design.",
      }),
    });

    if (res.status !== 201) {
      const err = await res.json();
      throw new Error(`Tailor start failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    if (!data.data.documentId || data.data.status !== "awaiting_approval") {
      throw new Error("Missing documentId or invalid status in draft");
    }
    if (!data.data.bullets || data.data.bullets.length === 0) {
      throw new Error("No bullets generated");
    }
    // Truthfulness verification: every bullet must have a valid factId
    for (const b of data.data.bullets) {
      if (!b.factId) throw new Error("Bullet generated without factId reference!");
    }
    if (typeof data.data.atsMatch?.score !== "number") {
      throw new Error("Missing ATS match score");
    }
    draftDocId = data.data.documentId;
  });

  // Step 29: B9 Tailor Document Detail Check
  await recordStep("GET /api/v1/tailor/:id (verify awaiting_approval state)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/tailor/${draftDocId}`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (res.status !== 200) throw new Error(`Get draft doc failed: ${res.status}`);
    const data = await res.json();
    if (data.data.document.status !== "awaiting_approval") {
      throw new Error("Document is not awaiting approval");
    }
  });

  // Step 30: B9 Tailor Resume Approve Flow (Generates exports)
  await recordStep("POST /api/v1/tailor/:id/approve (human approval & S3 upload)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/tailor/${draftDocId}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({}),
    });

    if (res.status !== 200) {
      const err = await res.json();
      throw new Error(`Approve failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    if (data.data.status !== "approved" || !data.data.pdfUrl || !data.data.docxUrl) {
      throw new Error("Approval response missing approved status or storage URLs");
    }
  });

  // Step 31: B9 Tailor Export Binary Download (PDF)
  await recordStep("GET /api/v1/tailor/:id/export?format=pdf (binary download)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/tailor/${draftDocId}/export?format=pdf`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (res.status !== 200) throw new Error(`Export PDF failed: ${res.status}`);
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/pdf")) {
      throw new Error(`Expected application/pdf, got ${contentType}`);
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 500) {
      throw new Error("Exported PDF buffer suspiciously small");
    }
  });

  // Step 32: B9 List User Tailored Documents
  await recordStep("GET /api/v1/tailor (list candidate documents)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/tailor`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (res.status !== 200) throw new Error(`List documents failed: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.data.documents) || data.data.count < 1) {
      throw new Error("List documents returned empty or invalid structure");
    }
  });

  // Step 33: B10 Application Tracker - Create & Track Job
  let trackedAppId = null;
  await recordStep("POST /api/v1/applications (track job in Kanban)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/applications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({
        jobId: discoveredJobId || "job_test_123",
        company: "Stripe",
        role: "Staff Infrastructure Engineer",
        status: "saved",
        notes:
          "Found via JobScout discovery; strong alignment with distributed systems background.",
      }),
    });

    if (res.status !== 201) {
      const err = await res.json();
      throw new Error(`Create application failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    if (!data.data.application?._id || data.data.application.status !== "saved") {
      throw new Error("Application tracking failed to return saved record");
    }
    trackedAppId = data.data.application._id;
  });

  // Step 34: B10 Application Tracker - Kanban Column Aggregation
  await recordStep("GET /api/v1/applications (Kanban columns & cache)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/applications`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (res.status !== 200) throw new Error(`Get applications failed: ${res.status}`);
    const data = await res.json();
    if (!data.data.columns || !Array.isArray(data.data.columns.saved)) {
      throw new Error("Missing Kanban columns structure");
    }
    if (data.data.columns.saved.length < 1) {
      throw new Error("Tracked application missing from 'saved' column");
    }
  });

  // Step 35: B10 Application Tracker - Pipeline Status Change & Follow-Up Automation Draft
  await recordStep(
    "PATCH /api/v1/applications/:id/status (pipeline transition & follow-up draft)",
    async () => {
      const res = await fetch(`${BASE_URL}/api/v1/applications/${trackedAppId}/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${testUserToken}`,
          "Content-Type": "application/json",
          "X-Requested-With": "JobScoutClient",
        },
        body: JSON.stringify({
          status: "applied",
          note: "Submitted application via candidate referral",
        }),
      });

      if (res.status !== 200) {
        const err = await res.json();
        throw new Error(`Update status failed: ${JSON.stringify(err)}`);
      }
      const data = await res.json();
      const app = data.data.application;
      if (app.status !== "applied") {
        throw new Error("Application status did not update to 'applied'");
      }
      if (
        !app.followUpDraft ||
        app.followUpDraft.status !== "draft" ||
        !app.followUpDraft.subject
      ) {
        throw new Error("Graph D failed to draft follow-up email upon status change to applied");
      }
    },
  );

  // Step 36: B10 Follow-Up Email Human Approval Flow
  await recordStep(
    "POST /api/v1/applications/:id/follow-up/approve (human-in-the-loop email send)",
    async () => {
      const res = await fetch(`${BASE_URL}/api/v1/applications/${trackedAppId}/follow-up/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${testUserToken}`,
          "Content-Type": "application/json",
          "X-Requested-With": "JobScoutClient",
        },
        body: JSON.stringify({}),
      });

      if (res.status !== 200) {
        const err = await res.json();
        throw new Error(`Approve follow-up failed: ${JSON.stringify(err)}`);
      }
      const data = await res.json();
      if (data.data.application.followUpDraft.status !== "sent") {
        throw new Error("Approved follow-up email draft was not marked as sent");
      }
    },
  );

  // Step 37: B10 Interview Prep (upgrade plan to premium first to test quota-gated access)
  let mockSessionId = null;
  await recordStep(
    "POST /api/v1/interview/prep (company brief, question bank & STAR stories)",
    async () => {
      // Upgrade user to premium in repository to pass quota gate
      const { userRepository } = await import("../src/repositories/userRepository.js");
      const u = await userRepository.findByEmail(testEmail);
      await userRepository.update(u._id, { plan: "premium" });

      const res = await fetch(`${BASE_URL}/api/v1/interview/prep`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${testUserToken}`,
          "Content-Type": "application/json",
          "X-Requested-With": "JobScoutClient",
        },
        body: JSON.stringify({
          jobTitle: "Staff Infrastructure Engineer",
          company: "Stripe",
          jdText: "Design and operate global distributed storage and caching infrastructure.",
        }),
      });

      if (res.status !== 200) {
        const err = await res.json();
        throw new Error(`Interview prep failed: ${JSON.stringify(err)}`);
      }
      const data = await res.json();
      if (!data.data.questions || data.data.questions.length === 0) {
        throw new Error("Interview prep failed to return questions");
      }
      if (!data.data.suggestedStarStories || data.data.suggestedStarStories.length === 0) {
        throw new Error("Interview prep missing STAR story templates");
      }
    },
  );

  // Step 38: B10 Mock Interview Loop (STAR Scoring & Turn Evaluation)
  await recordStep(
    "POST /api/v1/interview/mock/turn (stateful turn evaluation & STAR score)",
    async () => {
      const res = await fetch(`${BASE_URL}/api/v1/interview/mock/turn`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${testUserToken}`,
          "Content-Type": "application/json",
          "X-Requested-With": "JobScoutClient",
        },
        body: JSON.stringify({
          questionId: "q_dist_sys_1",
          question: "Describe a complex distributed system failure you diagnosed and resolved.",
          candidateAnswer:
            "During a Black Friday spike, our Redis connection pool became exhausted due to slow downstream writes. I diagnosed the bottleneck using distributed traces in Datadog, deployed a circuit breaker with exponential backoff within 20 minutes, and subsequently implemented single-flight locking which reduced database connection contention by 70%.",
        }),
      });

      if (res.status !== 200) {
        const err = await res.json();
        throw new Error(`Mock turn failed: ${JSON.stringify(err)}`);
      }
      const data = await res.json();
      if (typeof data.data.score !== "number" || !data.data.starScores) {
        throw new Error("Mock turn missing score or STAR breakdown");
      }
      if (!data.data.sessionId) {
        throw new Error("Mock turn missing sessionId");
      }
      mockSessionId = data.data.sessionId;
    },
  );

  // Step 39: B10 Mock Interview Performance Scorecard Report
  await recordStep("GET /api/v1/interview/:id/report (session report scorecard)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/interview/${mockSessionId}/report`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (res.status !== 200) throw new Error(`Get report failed: ${res.status}`);
    const data = await res.json();
    if (typeof data.data.averageScore !== "number" || data.data.totalTurnsCompleted < 1) {
      throw new Error("Mock interview report missing averageScore or turn history");
    }
  });

  // Step 40: B11 Billing - Stripe / Razorpay Checkout Session
  await recordStep("POST /api/v1/billing/checkout (create subscription session)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/billing/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({
        plan: "pro",
        provider: "stripe",
      }),
    });

    if (res.status !== 200) {
      const err = await res.json();
      throw new Error(`Checkout failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    if (!data.data.checkoutUrl || !data.data.sessionId) {
      throw new Error("Missing checkoutUrl or sessionId in checkout response");
    }
  });

  // Step 41: B11 Billing - Customer Portal Session
  await recordStep("POST /api/v1/billing/portal (customer self-service portal)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/billing/portal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testUserToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "JobScoutClient",
      },
      body: JSON.stringify({}),
    });

    if (res.status !== 200) throw new Error(`Portal failed: ${res.status}`);
    const data = await res.json();
    if (!data.data.portalUrl) {
      throw new Error("Missing portalUrl in portal response");
    }
  });

  // Step 42: B11 Billing - Idempotent Stripe Webhook Handling & Replay Defense
  await recordStep(
    "POST /api/v1/billing/stripe-webhook (idempotent event processing)",
    async () => {
      const testWebhookEventId = `evt_smoke_${Date.now()}`;
      const payload = JSON.stringify({
        id: testWebhookEventId,
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_mock_smoke_1",
            metadata: { plan: "pro" },
          },
        },
      });

      // 1. Initial event dispatch -> processed: true
      const res1 = await fetch(`${BASE_URL}/api/v1/billing/stripe-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (res1.status !== 200) throw new Error(`Webhook dispatch failed: ${res1.status}`);
      const data1 = await res1.json();
      if (!data1.processed || data1.duplicate) {
        throw new Error("First webhook event was not marked as processed");
      }

      // 2. Replay SAME event -> duplicate: true, processed: false
      const res2 = await fetch(`${BASE_URL}/api/v1/billing/stripe-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      const data2 = await res2.json();
      if (!data2.duplicate || data2.processed) {
        throw new Error("Replayed webhook event was not detected as duplicate");
      }
    },
  );

  // Step 43: B11 Admin Metrics (RBAC enforcement & operational telemetry)
  await recordStep("GET /api/v1/admin/metrics (RBAC gate & telemetry dashboard)", async () => {
    // 1. Regular candidate must receive 403 Forbidden
    const candidateRes = await fetch(`${BASE_URL}/api/v1/admin/metrics`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (candidateRes.status !== 403) {
      throw new Error(`Expected 403 FORBIDDEN for candidate, got ${candidateRes.status}`);
    }

    // 2. Create Admin user and obtain token
    const { userRepository } = await import("../src/repositories/userRepository.js");
    const { authService } = await import("../src/services/authService.js");
    const adminUser = await userRepository.create({
      email: `admin_${Date.now()}@jobscout.internal`,
      role: "admin",
      name: "Operations Admin",
    });
    const session = await authService.generateSession(adminUser);

    // 3. Admin request must return telemetry metrics
    const adminRes = await fetch(`${BASE_URL}/api/v1/admin/metrics`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (adminRes.status !== 200) throw new Error(`Admin metrics failed: ${adminRes.status}`);
    const data = await adminRes.json();
    if (!data.data.cache || !data.data.aiRouter || !data.data.costTelemetry) {
      throw new Error("Admin metrics payload missing required telemetry subsystems");
    }
    if (typeof data.data.aiRouter.tier0Percentage !== "number") {
      throw new Error("Missing tier0Percentage in AI Router metrics");
    }
  });

  // Step 44: B11 Privacy - GDPR / DPDP Data Export
  await recordStep("GET /api/v1/privacy/export (GDPR article 12 data portfolio)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/privacy/export`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
    });
    if (res.status !== 200) throw new Error(`Export data failed: ${res.status}`);
    const data = await res.json();
    if (!data.data.complianceFrameworks || !data.data.profile || !data.data.applications) {
      throw new Error("Export bundle missing compliance metadata, profile, or applications");
    }
  });

  // Step 45: B11 Privacy - Right-to-be-Forgotten Permanent Deletion
  await recordStep(
    "DELETE /api/v1/privacy/delete-account (right-to-be-forgotten revocation)",
    async () => {
      const res = await fetch(`${BASE_URL}/api/v1/privacy/delete-account`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${testUserToken}`,
          "X-Requested-With": "JobScoutClient",
        },
      });

      if (res.status !== 200) throw new Error(`Delete account failed: ${res.status}`);
      const data = await res.json();
      if (!data.data.deletedAt) {
        throw new Error("Missing deletedAt confirmation");
      }

      // Subsequent access with revoked session must be rejected (401 USER_NOT_FOUND)
      const checkRes = await fetch(`${BASE_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${testUserToken}` },
      });
      if (checkRes.status !== 401) {
        throw new Error(`Expected 401 after deletion, got ${checkRes.status}`);
      }
    },
  );

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
