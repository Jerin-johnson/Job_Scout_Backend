import test from "node:test";
import assert from "node:assert/strict";
import {
  createGroqModel,
  estimateGroqCost,
  groqProvider,
  toGroqMessages,
} from "../src/infrastructure/ai/providers/groq.js";

test("Groq adapter exposes a configured server-side provider and current free-plan chat models", () => {
  assert.equal(groqProvider.id, "groq");
  assert.equal(typeof groqProvider.isConfigured(), "boolean");
  assert.deepEqual(
    groqProvider.chatModels.map((model) => model.id),
    ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  );
  assert.equal(
    groqProvider.chatModels.every((model) => model.access === "free_tier"),
    true,
  );
});

test("Groq usage is normalized to conservative documented per-token cost", () => {
  assert.equal(
    estimateGroqCost("openai/gpt-oss-20b", { inputTokens: 1000, outputTokens: 1000 }),
    0.000375,
  );
  assert.throws(
    () => estimateGroqCost("unknown/model", { inputTokens: 1000, outputTokens: 1000 }),
    /unknown model/i,
  );
});

test("Groq LangChain adapter maps normalized messages and returns a stream-capable facade", () => {
  const model = createGroqModel({ modelName: "openai/gpt-oss-20b", temperature: 0, maxTokens: 50 });
  assert.equal(typeof model.invoke, "function");
  assert.equal(typeof model.stream, "function");
});

test("Groq adapter safely folds system instructions into a user message for GPT-OSS compatibility", () => {
  const messages = toGroqMessages([
    { role: "system", content: "Follow JobScout safety rules." },
    { role: "system", content: "<CANDIDATE_CONTEXT_DATA>Profile only.</CANDIDATE_CONTEXT_DATA>" },
    { role: "user", content: "What should I do next?" },
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]._getType(), "human");
  assert.match(messages[0].content, /Follow JobScout safety rules/);
  assert.match(messages[0].content, /<CANDIDATE_CONTEXT_DATA>/);
  assert.match(messages[0].content, /What should I do next\?/);
});
