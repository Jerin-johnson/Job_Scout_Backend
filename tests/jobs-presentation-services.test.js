import test from "node:test";
import assert from "node:assert/strict";
import {
  convertAmount,
  isFxRateStale,
  refreshReferenceRates,
} from "../src/infrastructure/database/mongoose/repositories/MongooseFxRateRepository.js";
import {
  getJobRiskFlags,
  detectRepostSignal,
  classifyLinkHealthStatus,
  sampleJobsForPoliteLinkCheck,
  computeSourceTermExpiry,
} from "../src/domain/services/jobs/jobRisk.js";
import { classifyEligibility } from "../src/domain/services/jobs/eligibility.js";
import { annualComparableAmount, scoreJobMatch } from "../src/domain/services/jobs/matching.js";

test("cross-currency conversion uses rates per EUR and rejects missing rates", () => {
  assert.equal(convertAmount(100, "USD", "INR", { EUR: 1, USD: 1.1, INR: 90 }), (100 / 1.1) * 90);
  assert.equal(convertAmount(100, "USD", "INR", { USD: 1.1 }), null);
});

test("ECB rate freshness retains old rates and reports their age", () => {
  const now = new Date("2026-10-16T00:00:00Z");
  assert.equal(isFxRateStale({ date: new Date("2026-10-15T00:00:00Z") }, { now }), false);
  assert.equal(isFxRateStale({ date: new Date("2026-10-01T00:00:00Z") }, { now }), true);
  assert.equal(isFxRateStale(null, { now }), true);
});

test("RBI and FBIL FX choices fail explicitly until an approved adapter exists", async () => {
  await assert.rejects(refreshReferenceRates({ source: "rbi" }), {
    code: "FX_SOURCE_NOT_AVAILABLE",
  });
  await assert.rejects(refreshReferenceRates({ source: "fbil" }), {
    code: "FX_SOURCE_NOT_AVAILABLE",
  });
});

test("risk flags are reason codes only and eligibility stays unknown without evidence", () => {
  const flags = getJobRiskFlags({
    company: "Unknown",
    rawDescription: "Pay a registration fee and contact us on WhatsApp only.",
  });
  assert.deepEqual(
    flags.map(({ code }) => code),
    ["fees_requested", "messaging_app_only", "company_unclear"],
  );
  assert.ok(flags.every(({ reason }) => typeof reason === "string"));
  assert.equal(classifyEligibility({ location: "Remote" }, {}).status, "unknown");
});

test("risk flags surface possible_repost, ghost_listing_risk, and broken_or_expired_link", () => {
  const now = new Date("2026-10-19T00:00:00Z");
  const flags = getJobRiskFlags(
    {
      company: "Acme Corp",
      rawDescription: "Build backend services in Node.js.",
      postedAt: new Date("2026-08-20T00:00:00Z"),
      firstSeenAt: new Date("2026-08-01T00:00:00Z"),
      lastSeenAt: new Date("2026-09-25T00:00:00Z"),
      repostCount: 2,
      status: "closed",
    },
    { now },
  );
  const codes = flags.map(({ code }) => code);
  assert.ok(codes.includes("older_listing"));
  assert.ok(codes.includes("possible_repost"));
  assert.ok(codes.includes("ghost_listing_risk"));
  assert.ok(codes.includes("broken_or_expired_link"));
});

test("detectRepostSignal increments repostCount when postedAt jumps ahead by 7+ days", () => {
  const existing = {
    firstSeenAt: new Date("2026-09-01T00:00:00Z"),
    postedAt: new Date("2026-09-01T00:00:00Z"),
    repostCount: 0,
  };
  const reposted = detectRepostSignal(existing, {
    postedAt: new Date("2026-09-15T00:00:00Z"),
  });
  assert.equal(reposted.isRepost, true);
  assert.equal(reposted.repostCount, 1);

  const minorEdit = detectRepostSignal(existing, {
    postedAt: new Date("2026-09-02T00:00:00Z"),
  });
  assert.equal(minorEdit.isRepost, false);
  assert.equal(minorEdit.repostCount, 0);
});

test("classifyLinkHealthStatus maps HTTP statuses and closed phrases to active/closed/unknown", () => {
  assert.equal(classifyLinkHealthStatus({ httpStatus: 404, bodySnippet: "" }).status, "closed");
  assert.equal(
    classifyLinkHealthStatus({
      httpStatus: 200,
      bodySnippet: "Sorry, this job is no longer available.",
    }).status,
    "closed",
  );
  assert.equal(
    classifyLinkHealthStatus({
      httpStatus: 200,
      bodySnippet: "Apply now for Senior Backend Engineer",
    }).status,
    "active",
  );
  assert.equal(classifyLinkHealthStatus({ httpStatus: 503, bodySnippet: "" }).status, "unknown");
});

test("sampleJobsForPoliteLinkCheck enforces per-host and total caps ordered by oldest check", () => {
  const jobs = [
    {
      sourceJobId: "1",
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
      sourceCheckedAt: null,
      lastSeenAt: "2026-10-01T00:00:00Z",
    },
    {
      sourceJobId: "2",
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/2",
      sourceCheckedAt: null,
      lastSeenAt: "2026-10-02T00:00:00Z",
    },
    {
      sourceJobId: "3",
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/3",
      sourceCheckedAt: null,
      lastSeenAt: "2026-10-03T00:00:00Z",
    },
    {
      sourceJobId: "4",
      canonicalUrl: "https://jobs.lever.co/beta/4",
      sourceCheckedAt: null,
      lastSeenAt: "2026-10-01T00:00:00Z",
    },
  ];
  const sampled = sampleJobsForPoliteLinkCheck(jobs, { maxTotal: 3, maxPerHost: 2 });
  assert.deepEqual(
    sampled.map((item) => item.sourceJobId),
    ["1", "4", "2"],
  );
});

test("computeSourceTermExpiry respects earliest of sourceExpiresAt and retentionDays window", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const postedAt = new Date("2026-09-25T00:00:00Z");
  const earlySourceExpiry = new Date("2026-10-05T00:00:00Z");
  assert.deepEqual(
    computeSourceTermExpiry({
      postedAt,
      now,
      sourceExpiresAt: earlySourceExpiry,
      retentionDays: 30,
    }),
    earlySourceExpiry,
  );
  const policyExpiry = computeSourceTermExpiry({
    postedAt,
    now,
    sourceExpiresAt: null,
    retentionDays: 14,
  });
  assert.deepEqual(policyExpiry, new Date("2026-10-09T00:00:00Z"));
});

test("salary comparison only compares known monthly or yearly periods in the target currency", () => {
  const rates = { EUR: 1, INR: 90, USD: 1.1 };
  assert.equal(
    annualComparableAmount({ amount: 1000, currency: "USD", period: "month" }, "INR", rates),
    (1000 / 1.1) * 90 * 12,
  );
  assert.equal(
    annualComparableAmount({ amount: 1000, currency: "USD", period: "hour" }, "INR", rates),
    null,
  );
  assert.equal(
    annualComparableAmount({ amount: 1000, currency: "USD", period: "year" }, "INR", null),
    null,
  );
});

test("lexical-v4 marks missing role facts low-confidence and keeps US-only jobs hard-blocked", () => {
  const profile = {
    skills: [],
    roles: [],
    preferences: { targetRoles: ["Software Engineer"], preferredCountryCodes: ["IN"] },
    careerProfile: {
      homeLocation: { countryCode: "IN" },
      experience: { needsConfirmation: true },
    },
  };
  const result = scoreJobMatch(
    profile,
    {
      title: "Software Engineer",
      location: "Remote US only",
      rawDescription: "Must be authorized to work in the US.",
      requirements: [],
      remoteType: "remote",
    },
    { version: "lexical-v4" },
  );
  assert.equal(result.confidence, "low");
  assert.equal(result.hardBlocked, true);
  assert.ok(result.reasons.some((reason) => reason.includes("Role facts are missing")));
});
