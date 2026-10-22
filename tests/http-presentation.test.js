import "reflect-metadata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

describe("Phase 6: Clean Architecture HTTP Presentation Layer", () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = "false";
    const { createApp } = await import("../dist/src/main/app.js");
    app = createApp();

    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
        resolve(null);
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    const { disconnectRedis } = await import("../dist/src/infrastructure/cache/redis.js").catch(
      () => import("../src/infrastructure/cache/redis.js"),
    );
    await disconnectRedis().catch(() => {});
  });

  it("GET /health should return 200 with status ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.status, "ok");
    assert.ok(json.timestamp);
  });

  it("POST /api/v1/auth/register should register user, return 201, and set cookies", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "controller_test@jobscout.com",
        password: "SecurePassword123!",
        name: "Controller Test User",
      }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.ok(json.data.user.id);
    assert.equal(json.data.user.email, "controller_test@jobscout.com");
    assert.ok(json.data.accessToken);

    const setCookie = res.headers.get("set-cookie") || "";
    assert.match(setCookie, /accessToken=/);
    assert.match(setCookie, /refreshToken=/);
  });

  it("POST /api/v1/auth/login should authenticate user and return 200 with accessToken", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "controller_test@jobscout.com",
        password: "SecurePassword123!",
      }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.data.accessToken);
    assert.equal(json.data.user.email, "controller_test@jobscout.com");
  });

  it("POST /api/v1/auth/login with invalid password should return 401 with typed error", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "controller_test@jobscout.com",
        password: "WrongPassword123!",
      }),
    });

    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error.code, "UNAUTHORIZED");
    assert.ok(json.error.message);
    assert.ok(json.error.requestId);
  });

  it("GET /api/v1/applications without token should return 401 unauthorized", async () => {
    const res = await fetch(`${baseUrl}/api/v1/applications`);
    assert.equal(res.status, 401);

    const json = await res.json();
    assert.equal(json.error.code, "UNAUTHORIZED");
    assert.ok(json.error.requestId);
  });

  it("POST /api/v1/interview/sessions/:id/transcription-session requires authentication", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/interview/sessions/${"a".repeat(24)}/transcription-session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consentAccepted: true }),
      },
    );
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error.code, "UNAUTHORIZED");
  });

  it("POST & GET /api/v1/applications with valid Bearer token should succeed", async () => {
    // 1. Get access token
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "controller_test@jobscout.com",
        password: "SecurePassword123!",
      }),
    });
    const loginJson = await loginRes.json();
    const token = loginJson.data.accessToken;

    // 2. Create application
    const createRes = await fetch(`${baseUrl}/api/v1/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        company: "Vercel",
        role: "Frontend Systems Engineer",
        priority: "high",
      }),
    });

    assert.equal(createRes.status, 201);
    const createJson = await createRes.json();
    assert.ok(createJson.data.id);
    assert.equal(createJson.data.companyName, "Vercel");
    assert.equal(createJson.data.status, "saved");

    // 3. List applications
    const listRes = await fetch(`${baseUrl}/api/v1/applications`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.ok(Array.isArray(listJson.data));
    assert.equal(listJson.data.length, 1);
    assert.equal(listJson.data[0].companyName, "Vercel");

    // 4. Update status
    const updateRes = await fetch(`${baseUrl}/api/v1/applications/${createJson.data.id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        status: "applied",
        note: "Applied through referral",
      }),
    });

    assert.equal(updateRes.status, 200);
    const updateJson = await updateRes.json();
    assert.equal(updateJson.data.status, "applied");
  });

  it("PUT & GET /api/v1/profile with valid token should upsert and return profile", async () => {
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "controller_test@jobscout.com",
        password: "SecurePassword123!",
      }),
    });
    const loginJson = await loginRes.json();
    const token = loginJson.data.accessToken;

    const putRes = await fetch(`${baseUrl}/api/v1/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        skills: ["Node.js", "TypeScript", "Express", "Clean Architecture"],
        preferences: { remotePreference: "remote" },
      }),
    });

    assert.equal(putRes.status, 200);
    const putJson = await putRes.json();
    assert.ok(putJson.data.id);
    assert.deepEqual(putJson.data.skills, [
      "Node.js",
      "TypeScript",
      "Express",
      "Clean Architecture",
    ]);

    const getRes = await fetch(`${baseUrl}/api/v1/profile`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.data.id, putJson.data.id);
    assert.equal(getJson.data.skills.length, 4);
  });
});
