import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogModelStatus,
  getModelRate,
  MODEL_PRICING_CATALOG,
} from "../src/infrastructure/ai/modelPricingCatalog.js";
import {
  effectiveDataPolicy,
  personalDataPolicyError,
  validateAIConfiguration,
} from "../src/infrastructure/ai/config/aiStartupValidation.js";

test("model catalog has priced exact IDs and effective Gemini 3.6/3.8 rates", () => {
  assert.equal(catalogModelStatus("gemini", "gemini-3.8-flash"), "priced");
  for (const modelId of ["gemini-3.6-flash", "gemini-3.8-flash"]) {
    assert.equal(
      getModelRate("gemini", modelId, new Date("2026-12-31T23:59:59Z")).inputUsdPerMillion,
      0.75,
    );
    assert.equal(
      getModelRate("gemini", modelId, new Date("2027-01-01T00:00:00Z")).inputUsdPerMillion,
      1.5,
    );
  }
  assert.ok(
    MODEL_PRICING_CATALOG.every(
      (entry) => entry.provider && entry.modelId && entry.status && entry.dataPolicyClass,
    ),
  );
});

test("unknown and retired model pricing is rejected rather than recorded as zero", () => {
  assert.equal(catalogModelStatus("gemini", "made-up-model"), "unknown");
  assert.equal(catalogModelStatus("anthropic", "claude-3-5-haiku-20241022"), "retired");
  assert.throws(() => getModelRate("gemini", "made-up-model"), /unknown model/i);
  assert.throws(() => getModelRate("anthropic", "claude-3-5-haiku-20241022"), /retired model/i);
});

test("production startup rejects retired/unpriced selected models and placeholders without exposing keys", () => {
  const config = {
    NODE_ENV: "production",
    AI_ALLOW_MOCKS: false,
    AI_BLOCK_UNPAID_PERSONAL_DATA: true,
    LLM_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "dummy-value-that-must-never-be-printed",
    MODEL_SMALL: "claude-3-5-haiku-20241022",
    MODEL_STRONG: "claude-3-5-sonnet-20241022",
    EMBEDDING_PROVIDER: "openai",
    OPENAI_API_KEY: "configured-test-key",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    DAILY_USER_USD_BUDGET: 1,
    GLOBAL_DAILY_USD_CAP: 10,
  };
  const message = validateAIConfiguration(config).join(" ");
  assert.match(message, /ANTHROPIC_API_KEY must be set/);
  assert.match(message, /retired/);
  assert.doesNotMatch(message, /dummy-value-that-must-never-be-printed/);
});

test("personal-data policy is provider-tier configuration, not inferred from model ID", () => {
  const productionConfig = {
    NODE_ENV: "production",
    AI_BLOCK_UNPAID_PERSONAL_DATA: true,
    GEMINI_DATA_POLICY_CLASS: "unpaid_free_tier",
  };
  assert.equal(effectiveDataPolicy("gemini", productionConfig), "unpaid_free_tier");
  assert.equal(
    personalDataPolicyError("gemini", "gemini-3.5-flash-lite", "resume_parse", productionConfig)
      ?.code,
    "AI_PERSONAL_DATA_PROVIDER_BLOCKED",
  );
  assert.equal(
    personalDataPolicyError("gemini", "gemini-3.5-flash-lite", "chat", {
      ...productionConfig,
      GEMINI_DATA_POLICY_CLASS: "paid_api",
    }),
    null,
  );
});
