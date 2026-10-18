import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/job-eligibility-patterns.json", import.meta.url), "utf8"));
import { classifyEligibility, parseJobEligibility, profileApplicantCountries } from "../src/services/jobs/eligibility.js";

test("eligibility parser covers explicit, regional, remote, timezone and unknown patterns", () => {
  for (const fixture of fixtures) {
    const result = parseJobEligibility(fixture.job);
    if (fixture.scope) assert.equal(result.remoteScope, fixture.scope, fixture.name);
    if (fixture.countries) assert.deepEqual(result.countries, fixture.countries, fixture.name);
    if (fixture.authorization !== undefined) assert.equal(result.workAuthorizationRequired, fixture.authorization, fixture.name);
  }
});

test("unknown never becomes eligible and explicit mismatches are not open", () => {
  const profile = { careerProfile: { homeLocation: { countryCode: "IN" } } };
  assert.equal(classifyEligibility({ location: "Remote" }, profile).status, "unknown");
  assert.equal(classifyEligibility({ location: "US only" }, profile).status, "not_open");
  assert.equal(classifyEligibility({ location: "Worldwide remote" }, profile).status, "eligible");
});

test("career-profile home, target and permitted relocation destinations are used locally", () => {
  const profile = { careerProfile: { homeLocation: { countryCode: "IN" }, targetLocations: [{ countryCode: "GB", scope: "country" }], workAuthorization: { canWorkInHomeCountry: true, sponsorshipOrRelocation: { enabled: true, countryCodes: ["AE"] } } } };
  assert.deepEqual(profileApplicantCountries(profile).sort(), ["AE", "GB", "IN"]);
  assert.equal(classifyEligibility({ structuredLocation: { countryCode: "US" }, location: "Remote" }, profile).status, "not_open");
  assert.equal(classifyEligibility({ location: "Remote", structuredLocation: { remoteScope: "worldwide" } }, profile).status, "eligible");
});

test("versioned eligibility parser maps common countries and hiring-region groups to ISO codes", () => {
  assert.ok(parseJobEligibility({ location: "Remote - India" }).countries.includes("IN"));
  assert.equal(parseJobEligibility({ location: "Remote in EMEA" }).remoteScope, "EMEA");
  assert.ok(parseJobEligibility({ location: "Remote in EMEA" }).countries.includes("AE"));
  assert.equal(parseJobEligibility({ location: "Remote in LATAM" }).remoteScope, "LATAM");
  assert.equal(parseJobEligibility({ location: "Remote in APAC" }).remoteScope, "APAC");
  assert.equal(parseJobEligibility({ location: "Remote in EU" }).remoteScope, "EU");
  assert.equal(parseJobEligibility({ location: "Remote in EMEA" }).version, 2);
  assert.equal(classifyEligibility({ location: "Remote in EMEA" }, { careerProfile: { homeLocation: { countryCode: "AE" } } }).status, "eligible");
  assert.equal(classifyEligibility({ location: "Remote in EMEA" }, { careerProfile: { homeLocation: { countryCode: "US" } } }).status, "not_open");
});
