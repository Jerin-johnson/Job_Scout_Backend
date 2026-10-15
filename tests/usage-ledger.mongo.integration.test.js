import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UsageEvent } from "../src/models/UsageEvent.js";
import { streamLLM } from "../src/ai/llm.js";

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());
test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test("stream cancellation awaits a partial usage ledger row", async () => {
  const userId = new mongoose.Types.ObjectId();
  const controller = new AbortController();
  const provider = {
    id: "gemini",
    isConfigured: () => true,
    modelForTier: () => "gemini-3.1-flash-lite",
    estimateCostUsd: (_model, { inputTokens = 0, outputTokens = 0 }) => (inputTokens * 0.25 + outputTokens * 1.5) / 1_000_000,
    createModel: () => ({
      async *stream(_messages, { signal }) {
        yield { content: "partial answer", usage_metadata: { input_tokens: 18, output_tokens: 3 } };
        if (signal.aborted) throw signal.reason || new Error("cancelled");
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason || new Error("cancelled")), { once: true });
        });
      },
    }),
  };
  const iterator = streamLLM({
    user: { _id: userId, plan: "premium", planVersion: "v1" },
    prompt: [{ role: "user", content: "test input" }],
    signal: controller.signal,
    requestId: "req-stream-cancel-test",
    providerOverride: provider,
  });

  const first = await iterator.next();
  assert.equal(first.value.text, "partial answer");
  controller.abort(new Error("client disconnected"));
  await assert.rejects(() => iterator.next());

  const event = await UsageEvent.findOne({ requestId: "req-stream-cancel-test" }).lean();
  assert.ok(event);
  assert.equal(event.provider, "gemini");
  assert.equal(event.status, "partial");
  assert.equal(event.outcome, "client_cancelled");
  assert.equal(event.inputTokens, 18);
  assert.equal(event.outputTokens, 3);
  assert.equal(event.usageIsEstimated, false);
  assert.equal(event.plan, "premium");
  assert.equal(event.planVersion, "v1");
  assert.ok(event.attemptId);
  assert.equal(event.pricingVersion, "2026-10-15.1");
});
