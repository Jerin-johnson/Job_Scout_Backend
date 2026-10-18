import test from "node:test";
import assert from "node:assert/strict";
import { decodeCatalogCursor, encodeCatalogCursor, projectJobDetail, splitJobForStorage } from "../src/services/jobs/jobStorage.js";

test("job storage separates list-safe data, details, and optional vectors", () => {
  const parts = splitJobForStorage({ title: "Nurse", rawDescription: "Details", requirements: ["RN"], embedding: [0.1, 0.2], embeddingMetadata: { provider: "voyage", model: "test", dimension: 2 } });
  assert.equal(parts.catalog.title, "Nurse");
  assert.equal("rawDescription" in parts.catalog, false);
  assert.equal(parts.details.description, "Details");
  assert.deepEqual(parts.vector, { vector: [0.1, 0.2], provider: "voyage", model: "test", dimension: 2 });
});

test("job detail projection keeps compatibility with legacy inline fields", () => {
  assert.deepEqual(projectJobDetail({ rawDescription: "legacy", requirements: ["old"] }, null), { rawDescription: "legacy", requirements: ["old"] });
  assert.deepEqual(projectJobDetail({ rawDescription: "legacy", requirements: ["old"] }, { description: "new", requirements: ["new"] }), { rawDescription: "new", requirements: ["new"] });
});

test("catalog cursors round trip and malformed cursors fail closed", () => {
  const cursor = { id: "507f1f77bcf86cd799439011", postedAt: "2026-10-15T12:00:00.000Z" };
  assert.deepEqual(decodeCatalogCursor(encodeCatalogCursor(cursor)), cursor);
  assert.throws(() => decodeCatalogCursor("not-a-cursor"), { code: "INVALID_CATALOG_CURSOR", statusCode: 400 });
});
