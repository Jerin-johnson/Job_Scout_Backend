import test from "node:test";
import assert from "node:assert/strict";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { executeModelCall } from "../src/ai/llm.js";
import { extractedFactsSchema } from "../src/services/resumeParserService.js";

test("model invocation omits a null AbortSignal and forwards a real signal", async () => {
  const calls = [];
  const model = {
    async invoke(messages, options) {
      calls.push({ messages, options });
      return "ok";
    },
  };
  const messages = [{ role: "user", content: "hello" }];

  assert.equal(await executeModelCall({ model, messages, signal: null }), "ok");
  assert.deepEqual(calls[0].options, {});

  const signal = new AbortController().signal;
  await executeModelCall({ model, messages, signal });
  assert.equal(calls[1].options.signal, signal);
});

test("resume extraction schema uses required properties for strict provider output", () => {
  const schema = toJsonSchema(extractedFactsSchema);
  function assertRequiredProperties(node, path = "root") {
    if (node.type === "array") {
      assertRequiredProperties(node.items, `${path}[]`);
      return;
    }
    if (node.type !== "object") return;
    assert.deepEqual(
      [...node.required].sort(),
      Object.keys(node.properties).sort(),
      `${path} must require every property for strict structured output`,
    );
    for (const [name, property] of Object.entries(node.properties)) {
      assertRequiredProperties(property, `${path}.${name}`);
    }
  }

  assertRequiredProperties(schema);
  assert.deepEqual(schema.properties.roles.items.properties.startDate.type, ["string", "null"]);
});
