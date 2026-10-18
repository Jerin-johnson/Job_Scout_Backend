import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyCandidate, parseCompanyCsv, validateCompanyCandidate } from "../scripts/ats-company-tools.js";
import { SOURCE_POLICIES, isSourceEnabledByEnvironment, isSourceActivationAllowed } from "../src/services/jobs/sourcePolicies.js";

test("ATS company CSV parser supports quoted commas and escaped quotes", () => {
  const [row] = parseCompanyCsv('name,careersUrl\n"Health, Inc.",https://boards.greenhouse.io/health\n');
  assert.deepEqual(row, { name: "Health, Inc.", careersurl: "https://boards.greenhouse.io/health" });
  assert.equal(normalizeCompanyCandidate(row).platform, "greenhouse");
});

test("candidate normalization accepts only recognized HTTPS ATS board hosts", () => {
  assert.equal(normalizeCompanyCandidate({ name: "Example", careersUrl: "https://jobs.lever.co/example" }).platform, "lever");
  assert.equal(normalizeCompanyCandidate({ name: "Bad", careersUrl: "https://evil.example/jobs/example" }).platform, undefined);
  assert.equal(normalizeCompanyCandidate({ name: "Example", ats: "ashby", slug: "example" }).slug, "example");
});

test("ATS validation summarizes counts from the public response", async () => {
  const candidate = normalizeCompanyCandidate({ name: "Example", ats: "lever", slug: "example" });
  const result = await validateCompanyCandidate(candidate, { fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, "manual");
    return new Response(JSON.stringify([{ categories: { location: "Remote - India" } }, { categories: { location: "London, UK" } }]), { status: 200, headers: { "content-type": "application/json" } });
  } });
  assert.equal(result.valid, true);
  assert.equal(result.jobCount, 2);
  assert.equal(result.remoteCount, 1);
  assert.equal(result.indiaCount, 1);
});

test("ATS validation rejects redirects and oversized board responses", async () => {
  const candidate = normalizeCompanyCandidate({ ats: "greenhouse", slug: "example" });
  const redirect = await validateCompanyCandidate(candidate, { fetchImpl: async () => new Response("", { status: 302, headers: { location: "https://evil.example" } }) });
  assert.equal(redirect.valid, false);
  assert.match(redirect.error, /Redirect rejected/);
  const large = await validateCompanyCandidate(candidate, { fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-length": "2000001" } }) });
  assert.equal(large.valid, false);
  assert.match(large.error, /2 MB/);
});

test("ATS ingestion requires its individual environment flag and Adzuna remains license-blocked", () => {
  assert.equal(isSourceEnabledByEnvironment("greenhouse", { ENABLE_GREENHOUSE_INGESTION: false }), false);
  assert.equal(isSourceEnabledByEnvironment("greenhouse", { ENABLE_GREENHOUSE_INGESTION: true }), true);
  const adzuna = SOURCE_POLICIES.find((source) => source.key === "adzuna-india");
  assert.equal(adzuna.activationStatus, "blocked_on_license");
  assert.equal(isSourceActivationAllowed(adzuna), false);
  assert.equal(isSourceActivationAllowed({ ...adzuna, commercialLicenseReference: "license", attributionBadgeVerified: true, storageDisplayTermsReviewed: true }), true);
});
