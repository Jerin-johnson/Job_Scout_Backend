import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// These tests exercise the explicitly enabled, non-production in-memory store.
process.env.AI_ALLOW_MOCKS = "true";
const { quotaService } =
  await import("../src/infrastructure/database/mongoose/services/quotaService.js");

test("accepted quota operation increments exactly once for a replayed key", async () => {
  const userId = `test-${randomUUID()}`;
  const idempotencyKey = randomUUID();
  const first = await quotaService.incrementQuota(userId, "chat", idempotencyKey, "premium");
  const replay = await quotaService.incrementQuota(userId, "chat", idempotencyKey, "premium");
  const count = await quotaService.getCounter(
    `quota:${userId}:chat:${new Date().toISOString().slice(0, 10)}`,
  );

  assert.equal(first, 1);
  assert.equal(replay, 1);
  assert.equal(count, 1);
});

test("quota counter refuses to use in-memory fallback when production store is unavailable", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = `
    await import('reflect-metadata');
    const { quotaService } = await import('./src/infrastructure/database/mongoose/services/quotaService.js');
    try {
      await quotaService.checkQuota({ _id: '507f1f77bcf86cd799439011', plan: 'premium' }, 'chat');
      process.exitCode = 2;
    } catch (error) {
      if (error.code !== 'AI_USAGE_STORE_UNAVAILABLE' || error.statusCode !== 503 || error.retryable !== true) process.exitCode = 3;
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", AI_ALLOW_MOCKS: "false" },
  });

  assert.equal(child.status, 0, child.stderr || child.stdout);
});
