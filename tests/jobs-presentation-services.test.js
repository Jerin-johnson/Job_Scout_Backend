import test from "node:test";
import assert from "node:assert/strict";
import { convertAmount, isFxRateStale } from "../src/services/jobs/fxRates.js";
import { getJobRiskFlags } from "../src/services/jobs/jobRisk.js";
import { classifyEligibility } from "../src/services/jobs/eligibility.js";
import { annualComparableAmount, scoreJobMatch } from "../src/services/jobs/matching.js";

test("cross-currency conversion uses rates per EUR and rejects missing rates", () => {
  assert.equal(convertAmount(100, "USD", "INR", { EUR: 1, USD: 1.1, INR: 90 }), 100 / 1.1 * 90);
  assert.equal(convertAmount(100, "USD", "INR", { USD: 1.1 }), null);
});

test("ECB rate freshness retains old rates and reports their age", () => {
  const now = new Date("2026-10-16T00:00:00Z");
  assert.equal(isFxRateStale({ date: new Date("2026-10-15T00:00:00Z") }, { now }), false);
  assert.equal(isFxRateStale({ date: new Date("2026-10-01T00:00:00Z") }, { now }), true);
  assert.equal(isFxRateStale(null, { now }), true);
});

test("risk flags are reason codes only and eligibility stays unknown without evidence", () => {
  const flags = getJobRiskFlags({ company: "Unknown", rawDescription: "Pay a registration fee and contact us on WhatsApp only." });
  assert.deepEqual(flags.map(({ code }) => code), ["fees_requested", "messaging_app_only", "company_unclear"]);
  assert.ok(flags.every(({ reason }) => typeof reason === "string"));
  assert.equal(classifyEligibility({ location: "Remote" }, {}).status, "unknown");
});

test("salary comparison only compares known monthly or yearly periods in the target currency", () => {
  const rates = { EUR: 1, INR: 90, USD: 1.1 };
  assert.equal(annualComparableAmount({ amount: 1000, currency: "USD", period: "month" }, "INR", rates), 1000 / 1.1 * 90 * 12);
  assert.equal(annualComparableAmount({ amount: 1000, currency: "USD", period: "hour" }, "INR", rates), null);
  assert.equal(annualComparableAmount({ amount: 1000, currency: "USD", period: "year" }, "INR", null), null);
});

test("lexical-v4 marks missing role facts low-confidence and keeps US-only jobs hard-blocked", () => {
  const profile = { skills: [], roles: [], preferences: { targetRoles: ["Software Engineer"], preferredCountryCodes: ["IN"] }, careerProfile: { homeLocation: { countryCode: "IN" }, experience: { needsConfirmation: true } } };
  const result = scoreJobMatch(profile, { title: "Software Engineer", location: "Remote US only", rawDescription: "Must be authorized to work in the US.", requirements: [], remoteType: "remote" }, { version: "lexical-v4" });
  assert.equal(result.confidence, "low");
  assert.equal(result.hardBlocked, true);
  assert.ok(result.reasons.some((reason) => reason.includes("Role facts are missing")));
});
