import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyProviderError,
  invokeWithTransientRetry,
  isTransientProviderError,
  providerStatusCode,
} from "../src/infrastructure/ai/providerErrors.js";

test("Gemini network failures are classified without exposing provider error text", () => {
  const error = new Error("[GoogleGenerativeAI Error]: fetch failed");
  const classified = classifyProviderError(error);
  assert.equal(isTransientProviderError(error), true);
  assert.equal(classified.code, "AI_PROVIDER_NETWORK_ERROR");
  assert.match(classified.message, /outbound internet access/);
  assert.doesNotMatch(classified.message, /GoogleGenerativeAI/);
});

test("Gemini quota and credential failures explain the next step", () => {
  assert.equal(classifyProviderError({ status: 429 }).code, "AI_PROVIDER_RATE_LIMITED");
  assert.match(classifyProviderError({ status: 403 }).message, /API key or project access/);
});

test("provider failures classify service outages and Groq capacity without leaking vendor errors", () => {
  const unavailable = classifyProviderError(
    { status: 503, message: "upstream internal trace abc" },
    "groq",
  );
  assert.equal(unavailable.code, "AI_PROVIDER_UNAVAILABLE");
  assert.match(unavailable.message, /Groq is temporarily unavailable/);
  assert.doesNotMatch(unavailable.message, /internal trace/);
  const capacity = classifyProviderError({ status: 498 }, "groq");
  assert.equal(capacity.code, "AI_PROVIDER_CAPACITY");
  assert.equal(
    classifyProviderError(new Error("upstream request returned 503 internal"), "gemini").code,
    "AI_PROVIDER_UNAVAILABLE",
  );
  assert.equal(providerStatusCode(new Error("upstream request returned 503 internal")), 503);
  assert.equal(
    classifyProviderError({ status: 404 }, "gemini").code,
    "AI_PROVIDER_MODEL_UNAVAILABLE",
  );
  assert.equal(classifyProviderError({ status: 400 }, "groq").code, "AI_PROVIDER_INVALID_REQUEST");
});

test("transient provider invoke retries within the ceiling, while validation and timeout errors do not retry", async () => {
  let calls = 0;
  const result = await invokeWithTransientRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed");
      return "ok";
    },
    { sleep: async () => {} },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(() =>
    invokeWithTransientRetry(
      async () => {
        calls += 1;
        const error = new Error("bad request");
        error.status = 400;
        throw error;
      },
      { sleep: async () => {} },
    ),
  );
  assert.equal(calls, 1);

  for (const timeout of [
    Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }),
    Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    Object.assign(new Error("request timeout"), { status: 408 }),
  ]) {
    assert.equal(isTransientProviderError(timeout), false);
    calls = 0;
    await assert.rejects(() =>
      invokeWithTransientRetry(
        async () => {
          calls += 1;
          throw timeout;
        },
        { maxRetries: 2, sleep: async () => {} },
      ),
    );
    assert.equal(calls, 1);
  }
  assert.equal(
    isTransientProviderError(Object.assign(new Error("Gateway Timeout"), { status: 504 })),
    true,
  );

  calls = 0;
  await assert.rejects(() =>
    invokeWithTransientRetry(
      async () => {
        calls += 1;
        const error = new Error("temporary provider issue");
        error.status = 503;
        throw error;
      },
      { maxRetries: 2, sleep: async () => {} },
    ),
  );
  assert.equal(calls, 3);
});
