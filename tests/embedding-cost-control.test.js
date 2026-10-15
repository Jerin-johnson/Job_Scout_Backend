import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const { embeddingService } = await import("../src/services/embeddingService.js");
const { CacheKeys } = await import("../src/shared/cache.js");
const { Job } = await import("../src/models/Job.js");

test("explicit local mock embeddings return provider, model and dimension metadata", async () => {
  const result = await embeddingService.getEmbeddingWithMetadata("a test query");
  assert.equal(result.metadata.provider, "mock");
  assert.equal(result.metadata.model, "deterministic-v1");
  assert.equal(result.metadata.dimension, result.vector.length);
});

test("embedding cache key changes with provider, model and dimension", () => {
  const base = CacheKeys.embedding("content-hash", "openai", "text-embedding-3-small", 1536);
  assert.notEqual(base, CacheKeys.embedding("content-hash", "voyage", "voyage-large-2-instruct", 1024));
  assert.notEqual(base, CacheKeys.embedding("content-hash", "openai", "text-embedding-3-small", 1024));
});

test("legacy job vectors remain without inferred embedding metadata", () => {
  const legacy = Job.hydrate({ contentHash: "legacy", title: "Role", company: "Company", rawDescription: "Description", sourceBoard: "test", embedding: [0.1, 0.2] });
  assert.equal(legacy.embeddingMetadata?.provider, undefined);
  assert.equal(legacy.embeddingMetadata?.model, undefined);
  assert.equal(legacy.embeddingMetadata?.dimension, undefined);
});

test("production rejects mock embeddings even if the mock flag is accidentally enabled", () => {
  const script = `
    const { embeddingService } = await import('./src/services/embeddingService.js');
    try {
      await embeddingService.getEmbeddingWithMetadata('private profile text');
      process.exitCode = 2;
    } catch (error) {
      if (!['AI_USAGE_STORE_UNAVAILABLE', 'EMBEDDING_PROVIDER_NOT_CONFIGURED'].includes(error.code) || error.statusCode !== 503) process.exitCode = 3;
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", AI_ALLOW_MOCKS: "true", OPENAI_API_KEY: "dummy_openai_key" },
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("embedding calls honor the global AI kill switch", () => {
  const script = `
    const { embeddingService } = await import('./src/services/embeddingService.js');
    try {
      await embeddingService.getEmbeddingWithMetadata('test');
      process.exitCode = 2;
    } catch (error) {
      if (error.code !== 'AI_KILL_SWITCH_ACTIVE' || error.statusCode !== 503) process.exitCode = 3;
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", AI_ALLOW_MOCKS: "false", AI_KILL_SWITCH: "true" },
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("system embeddings fail closed in production when the shared quota store is unavailable", () => {
  const script = `
    const { embeddingService } = await import('./src/services/embeddingService.js');
    try {
      await embeddingService.assertAvailable();
      process.exitCode = 2;
    } catch (error) {
      if (error.code !== 'AI_USAGE_STORE_UNAVAILABLE' || error.statusCode !== 503 || error.retryable !== true) process.exitCode = 3;
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", AI_ALLOW_MOCKS: "false", AI_KILL_SWITCH: "false" },
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
