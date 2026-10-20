import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchTokens,
  boundedEditDistance,
  expandQueryTokensWithTypos,
  scoreCatalogSearchRelevance,
  compareJobsByRelevance,
  isAfterRelevanceCursor,
} from "../src/domain/services/jobs/jobSearch.js";
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
} from "../src/infrastructure/database/mongoose/storage/jobStorageCompaction.js";

test("buildSearchTokens deduplicates and orders title, company, skill, and location tokens", () => {
  const tokens = buildSearchTokens({
    title: "Senior Registered Nurse",
    company: "Apollo Healthcare",
    features: {
      titleTokens: ["senior", "registered", "nurse"],
      companyTokens: ["apollo", "healthcare"],
      skills: ["icu", "patient care", "bls"],
    },
    tags: ["critical-care", "nursing"],
    occupation: "nursing",
    structuredLocation: { city: "Kochi", countryCode: "IN" },
  });
  assert.ok(tokens.includes("registered"));
  assert.ok(tokens.includes("nurse"));
  assert.ok(tokens.includes("apollo"));
  assert.ok(tokens.includes("icu"));
  assert.ok(tokens.includes("kochi"));
  assert.equal(new Set(tokens).size, tokens.length);
});

test("boundedEditDistance and expandQueryTokensWithTypos handle common single-edit and transposition typos", () => {
  assert.equal(boundedEditDistance("software", "softwre", 2), 1);
  assert.equal(boundedEditDistance("nurse", "nruse", 2), 1);
  assert.ok(boundedEditDistance("software", "accounting", 2) > 2);

  const spec = expandQueryTokensWithTypos("softwre enginer typescrpt");
  assert.equal(spec.typoCorrections.softwre, "software");
  assert.equal(spec.typoCorrections.enginer, "engineer");
  assert.equal(spec.typoCorrections.typescrpt, "typescript");
  assert.ok(spec.tokenGroups[0].all.includes("software"));
  assert.ok(spec.tokenGroups[1].all.includes("engineer"));
  assert.ok(spec.tokenGroups[2].all.includes("typescript"));
});

test("scoreCatalogSearchRelevance blends weighted title/skill/company matches with recency", () => {
  const asOfDay = Date.UTC(2026, 9, 19);
  const querySpec = expandQueryTokensWithTypos("registered nurse icu");

  const recentTitleAndSkillMatch = {
    _id: "507f1f77bcf86cd799439011",
    title: "Registered Nurse - ICU",
    company: "City Hospital",
    features: {
      titleTokens: ["registered", "nurse", "icu"],
      companyTokens: ["city", "hospital"],
      skills: ["icu", "bls"],
    },
    postedAt: new Date(asOfDay - 1 * 86400000).toISOString(),
    postedDateKnown: true,
  };

  const olderCompanyOnlyMatch = {
    _id: "507f1f77bcf86cd799439012",
    title: "Operations Coordinator",
    company: "Nurse ICU Staffing",
    features: {
      titleTokens: ["operations", "coordinator"],
      companyTokens: ["nurse", "icu", "staffing"],
      skills: ["Registered"],
    },
    postedAt: new Date(asOfDay - 25 * 86400000).toISOString(),
    postedDateKnown: true,
  };

  const s1 = scoreCatalogSearchRelevance(recentTitleAndSkillMatch, querySpec, asOfDay);
  const s2 = scoreCatalogSearchRelevance(olderCompanyOnlyMatch, querySpec, asOfDay);
  assert.ok(s1.lexicalScore > s2.lexicalScore);
  assert.ok(s1.recencyScore > s2.recencyScore);
  assert.ok(s1.relevanceScore > s2.relevanceScore);
});

test("relevance sort comparator and cursor pagination produce stable non-overlapping pages", () => {
  const asOfDay = Date.UTC(2026, 9, 19);
  const items = [
    { _id: "507f1f77bcf86cd799439013", relevanceScore: 25, postedAt: "2026-10-18T00:00:00.000Z" },
    { _id: "507f1f77bcf86cd799439011", relevanceScore: 40, postedAt: "2026-10-17T00:00:00.000Z" },
    { _id: "507f1f77bcf86cd799439012", relevanceScore: 40, postedAt: "2026-10-18T00:00:00.000Z" },
    { _id: "507f1f77bcf86cd799439014", relevanceScore: 25, postedAt: "2026-10-18T00:00:00.000Z" },
  ].sort(compareJobsByRelevance);

  assert.deepEqual(
    items.map((item) => item._id),
    [
      "507f1f77bcf86cd799439012",
      "507f1f77bcf86cd799439011",
      "507f1f77bcf86cd799439013",
      "507f1f77bcf86cd799439014",
    ],
  );

  const page1 = items.slice(0, 2);
  const last = page1.at(-1);
  const encoded = encodeCatalogCursor({
    id: last._id,
    postedAt: last.postedAt,
    relevanceScore: last.relevanceScore,
    asOfDay,
    sort: "relevance",
  });
  const decoded = decodeCatalogCursor(encoded);
  const page2 = items.filter((item) => isAfterRelevanceCursor(item, decoded));
  assert.deepEqual(
    page2.map((item) => item._id),
    ["507f1f77bcf86cd799439013", "507f1f77bcf86cd799439014"],
  );
});
