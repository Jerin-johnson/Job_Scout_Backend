import test from "node:test";
import assert from "node:assert/strict";
import { LicensedFeedAdapter } from "../src/infrastructure/external-services/jobs/adapters/licensedFeedAdapter.js";

const config = {
  key: "fixture-vendor",
  licenseReference: "fixture-license-v1",
  attributionText: "Fixture vendor",
  attributionUrl: "https://vendor.example",
  retentionDays: 7,
  quota: { requestsPerDay: 3 },
  monthlyCreditBudget: 10,
  requestCredits: 2,
};

test("licensed adapter requires license, attribution, retention, quota, durable budget reservation, and kill switch", () => {
  assert.throws(
    () => new LicensedFeedAdapter({ ...config, licenseReference: "" }),
    /license reference/i,
  );
  assert.throws(() => new LicensedFeedAdapter({ ...config, quota: null }), /quota/i);
  assert.throws(
    () =>
      new LicensedFeedAdapter({
        ...config,
        reserveCredits: null,
        provider: { fetchPage() {} },
        isEnabled: () => true,
      }),
    /credit reservation/i,
  );
});

test("licensed adapter sends ATS-only filter and enforces kill switch and credit cap", async () => {
  let passedOptions;
  const adapter = new LicensedFeedAdapter({
    ...config,
    isEnabled: () => true,
    reserveCredits: async (request) => ({
      accepted: request.credits <= request.monthlyCreditBudget,
    }),
    provider: {
      fetchPage: async (options) => {
        passedOptions = options;
        return { jobs: [{ sourceType: "ats", id: "1" }], cursor: "c1" };
      },
    },
  });
  const result = await adapter.fetchPage({ cursor: "c0" });
  assert.equal(result.jobs.length, 1);
  assert.equal(passedOptions.atsNativeOnly, true);
  const noBudget = new LicensedFeedAdapter({
    ...config,
    isEnabled: () => true,
    reserveCredits: async () => ({ accepted: false }),
    provider: { fetchPage: async () => ({ jobs: [] }) },
  });
  await assert.rejects(noBudget.fetchPage(), /budget is exhausted/i);
  const disabled = new LicensedFeedAdapter({
    ...config,
    isEnabled: () => false,
    reserveCredits: async () => ({ accepted: true }),
    provider: { fetchPage: async () => ({ jobs: [] }) },
  });
  await assert.rejects(disabled.fetchPage(), /kill switch/i);
  const mixedSource = new LicensedFeedAdapter({
    ...config,
    isEnabled: () => true,
    reserveCredits: async () => ({ accepted: true }),
    provider: { fetchPage: async () => ({ jobs: [{ sourceType: "job-board" }] }) },
  });
  await assert.rejects(mixedSource.fetchPage(), /ATS-native-only/i);
});
