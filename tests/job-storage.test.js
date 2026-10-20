import test from "node:test";
import assert from "node:assert/strict";
import { BSON } from "mongodb";
import {
  compactHotFeatures,
  compactHotJobFields,
  decodeCatalogCursor,
  encodeCatalogCursor,
  normalizeProvenanceList,
  projectJobDetail,
  splitJobForStorage,
} from "../src/infrastructure/database/mongoose/storage/jobStorageCompaction.js";

test("job storage separates list-safe data, details, and optional vectors", () => {
  const parts = splitJobForStorage({
    title: "Nurse",
    rawDescription: "Details",
    requirements: ["RN"],
    provenance: [
      {
        source: "jobicy",
        sourceJobId: "j-1",
        canonicalUrl: "https://jobicy.example/jobs/1",
        attributionText: "Jobicy",
        attributionUrl: "https://jobicy.com",
        seenAt: "2026-10-18T00:00:00.000Z",
      },
    ],
    embedding: [0.1, 0.2],
    embeddingMetadata: { provider: "voyage", model: "test", dimension: 2 },
  });
  assert.equal(parts.catalog.title, "Nurse");
  assert.equal("rawDescription" in parts.catalog, false);
  assert.equal("provenance" in parts.catalog, false);
  assert.equal(parts.details.description, "Details");
  assert.equal(parts.details.provenance.length, 1);
  assert.equal(parts.details.provenance[0].source, "jobicy");
  assert.deepEqual(parts.vector, {
    vector: [0.1, 0.2],
    provider: "voyage",
    model: "test",
    dimension: 2,
  });
});

test("job detail projection keeps compatibility with legacy inline fields and normalizes provenance", () => {
  assert.deepEqual(projectJobDetail({ rawDescription: "legacy", requirements: ["old"] }, null), {
    rawDescription: "legacy",
    requirements: ["old"],
    provenance: [],
  });
  assert.deepEqual(
    projectJobDetail(
      { rawDescription: "legacy", requirements: ["old"] },
      { description: "new", requirements: ["new"], provenance: [{ field: "title" }] },
    ),
    { rawDescription: "new", requirements: ["new"], provenance: [{ field: "title" }] },
  );
  const normalized = normalizeProvenanceList([
    {
      _id: "subdoc-1",
      source: "remoteok",
      sourceJobId: "123",
      canonicalUrl: "https://remoteok.com/123",
    },
  ]);
  assert.equal("_id" in normalized[0], false);
  assert.equal(normalized[0].source, "remoteok");
});

test("compactHotFeatures and compactHotJobFields keep hot Job BSON well below 2 KB", () => {
  const bulkyFeatures = {
    version: 1,
    skills: Array.from({ length: 80 }, (_, idx) => `skill-${idx}`),
    requiredSkills: Array.from({ length: 40 }, (_, idx) => `req-${idx}`),
    preferredSkills: Array.from({ length: 40 }, (_, idx) => `pref-${idx}`),
    titleTokens: ["senior", "backend", "software", "engineer"],
    companyTokens: ["acme", "cloud"],
    occupation: "software_engineering",
    experienceYears: 5,
    seniority: "senior",
    education: ["bachelor", "master"],
    licenses: [],
    employmentType: "full-time",
    workMode: "remote",
    eligibilityHints: ["india only"],
    salaryText: "$120,000 - $160,000 per year plus equity and annual bonus",
    responsibilities: [
      "You will design and build high-throughput backend microservices.",
      "Responsible for database indexing, query performance, and reliability.",
    ],
  };
  const slim = compactHotFeatures(bulkyFeatures);
  assert.equal("responsibilities" in slim, false);
  assert.equal("salaryText" in slim, false);
  assert.ok(slim.skills.length <= 18);
  assert.ok(slim.requiredSkills.length <= 10);

  const compactedJob = compactHotJobFields({
    title: "Senior Backend Software Engineer",
    company: "Acme Cloud",
    location: "Bengaluru, India",
    remoteType: "remote",
    status: "active",
    sourceBoard: "remoteok",
    rawDescription: "x".repeat(8000),
    requirements: Array.from({ length: 20 }, (_, i) => `Requirement line ${i}`),
    provenance: [{ source: "remoteok", sourceJobId: "1" }],
    embedding: Array.from({ length: 1024 }, () => 0.01),
    features: bulkyFeatures,
    tags: Array.from({ length: 30 }, (_, i) => `tag-${i}`),
    searchTokens: Array.from({ length: 50 }, (_, i) => `tok-${i}`),
  });
  const bsonBytes = BSON.calculateObjectSize(compactedJob);
  assert.ok(bsonBytes < 2048, `Expected compacted hot job BSON < 2048 bytes, got ${bsonBytes}`);
});

test("catalog cursors round trip and malformed cursors fail closed", () => {
  const cursor = { id: "507f1f77bcf86cd799439011", postedAt: "2026-10-15T12:00:00.000Z" };
  assert.deepEqual(decodeCatalogCursor(encodeCatalogCursor(cursor)), cursor);
  assert.throws(() => decodeCatalogCursor("not-a-cursor"), {
    code: "INVALID_CATALOG_CURSOR",
    statusCode: 400,
  });
});
