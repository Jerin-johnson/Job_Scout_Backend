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
