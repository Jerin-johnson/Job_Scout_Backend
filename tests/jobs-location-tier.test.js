import test from "node:test";
import assert from "node:assert/strict";
import { locationTierForJob } from "../src/infrastructure/ai/graphs/discoveryGraph.js";

test("location ranking aliases cities and falls back to regional or unknown-eligibility remote roles", () => {
  const locations = ["Cochin"];
  assert.equal(
    locationTierForJob({ location: "Kochi, Kerala", remoteType: "onsite" }, locations),
    1,
  );
  assert.equal(
    locationTierForJob({ location: "Thiruvananthapuram, India", remoteType: "onsite" }, locations),
    2,
  );
  assert.equal(
    locationTierForJob(
      {
        location: "Remote",
        remoteType: "remote",
        structuredLocation: { remoteScope: "unknown", eligibleCountryCodes: [] },
      },
      locations,
      ["IN"],
    ),
    3,
  );
  assert.equal(
    locationTierForJob(
      {
        location: "Worldwide",
        remoteType: "remote",
        structuredLocation: { remoteScope: "worldwide" },
      },
      locations,
      ["IN"],
    ),
    4,
  );
});

test("no location preference does not bias candidates toward remote jobs", () => {
  assert.equal(locationTierForJob({ location: "Bengaluru", remoteType: "onsite" }, []), 1);
  assert.equal(locationTierForJob({ location: "Remote", remoteType: "remote" }, []), 1);
});
