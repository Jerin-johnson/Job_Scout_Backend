import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { container } from "tsyringe";
import { ClientComponent, MockTestService, TOKENS } from "../dist/src/main/container.js";

test("TSyringe foundation: container resolves constructor-injected dependencies", () => {
  const testContainer = container.createChildContainer();
  testContainer.register(TOKENS.TestService, { useClass: MockTestService });
  const consumer = testContainer.resolve(ClientComponent);
  assert.equal(consumer.getVal(), "mocked");
});
