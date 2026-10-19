import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupTestContainer, TestConsumer } from "../dist/src/main/container.js";

test("TSyringe foundation: container resolves constructor-injected dependencies", () => {
  const container = setupTestContainer();
  const consumer = container.resolve(TestConsumer);
  assert.equal(consumer.run(), "tsyringe_verified");
});
