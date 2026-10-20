import test from "node:test";
import assert from "node:assert/strict";
import {
  getLLMProvider,
  listLLMProviders,
  registerLLMProvider,
} from "../src/infrastructure/ai/providers/index.js";
import {
  listChatModelOptions,
  listSelectableChatModels,
  resolveChatModelForTier,
  resolveSelectableChatModel,
} from "../src/infrastructure/ai/modelCatalog.js";

test("provider registry validates and exposes adapters through the shared contract", () => {
  const names = listLLMProviders().map((provider) => provider.id);
  assert.deepEqual(names, ["gemini", "groq", "anthropic"]);
  for (const name of names) {
    const provider = getLLMProvider(name);
    assert.equal(typeof provider.isConfigured, "function");
    assert.equal(typeof provider.modelForTier, "function");
    assert.equal(typeof provider.createModel, "function");
    assert.equal(typeof provider.estimateCostUsd, "function");
  }
  assert.throws(() => registerLLMProvider({}), /must implement/);
});

test("chat model catalog exposes only models from configured adapters and resolves tiers", () => {
  const configuredModels = listSelectableChatModels();
  assert.ok(configuredModels.length > 0);
  for (const model of configuredModels) {
    assert.equal(getLLMProvider(model.provider).isConfigured(), true);
    assert.equal(resolveSelectableChatModel(model.id)?.provider, model.provider);
  }
  assert.equal(resolveSelectableChatModel("model-not-allowlisted"), null);
  assert.equal(listChatModelOptions()[0].id, "auto");
  assert.ok(["small", "strong"].includes(resolveChatModelForTier("small")?.tier));
});
