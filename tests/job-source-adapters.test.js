import test from "node:test";
import assert from "node:assert/strict";
import {
  BaseJobAdapter,
  sourceDescriptionText,
} from "../src/infrastructure/external-services/jobs/adapters/baseAdapter.js";
import { normalizeRemoteOkJob } from "../src/infrastructure/external-services/jobs/adapters/remoteOkAdapter.js";
import { normalizeRemotiveJob } from "../src/infrastructure/external-services/jobs/adapters/remotiveAdapter.js";
import { normalizeJobicyJob } from "../src/infrastructure/external-services/jobs/adapters/jobicyAdapter.js";
import {
  isSourcePolicyComplete,
  isSourceActivationAllowed,
  SOURCE_POLICIES,
} from "../src/domain/services/jobs/sourcePolicies.js";
import { jobIngestionService } from "../src/infrastructure/external-services/jobs/ingestion/JobIngestionEngine.js";
import { normalizePublicAtsJob } from "../src/infrastructure/external-services/jobs/adapters/publicAtsAdapter.js";
import { normalizeAdzunaJob } from "../src/infrastructure/external-services/jobs/adapters/adzunaAdapter.js";
import {
  detectAtsCareersUrl,
  verifyPublicBoard,
} from "../src/infrastructure/database/mongoose/repositories/MongooseTrackedCompanyRepository.js";

test("source identity uses source IDs first, then URL, then normalized company-title-location", () => {
  const adapter = new BaseJobAdapter({ key: "test" });
  const sourceId = adapter.generateIdentity({
    source: "test",
    sourceJobId: "42",
    canonicalUrl: "https://a.example/one",
    title: "One",
    company: "A",
    location: "Remote",
  });
  assert.equal(
    sourceId,
    adapter.generateIdentity({
      source: "test",
      sourceJobId: "42",
      canonicalUrl: "https://a.example/two",
      title: "Different",
      company: "B",
      location: "Elsewhere",
    }),
  );
  const urlId = adapter.generateIdentity({
    source: "test",
    canonicalUrl: "https://a.example/one/",
    title: "One",
    company: "A",
    location: "Remote",
  });
  assert.equal(
    urlId,
    adapter.generateIdentity({
      source: "test",
      canonicalUrl: "https://a.example/one",
      title: "Different",
      company: "B",
      location: "Elsewhere",
    }),
  );
  assert.equal(
    adapter.generateIdentity({
      source: "test",
      title: "Engineer",
      company: " ACME ",
      location: "Remote",
    }),
    adapter.generateIdentity({
      source: "test",
      title: " engineer ",
      company: "acme",
      location: " remote ",
    }),
  );
});

test("canonical URL group identity ignores tracking; entity keys preserve distinct roles and reposts", () => {
  const adapter = new BaseJobAdapter({ key: "test" });
  const urlA = adapter.generateGroupKey({
    canonicalUrl: "HTTPS://WWW.Example.com/jobs/1/?utm_source=feed#apply",
    title: "Engineer",
    company: "A",
  });
  const urlB = adapter.generateGroupKey({
    canonicalUrl: "https://example.com/jobs/1/",
    title: "Different title",
    company: "B",
  });
  assert.equal(urlA, urlB);
  const first = adapter.generateGroupKey({
    company: "Acme",
    title: "Nurse",
    location: "Delhi, IN",
    postedAt: "2026-10-01T00:00:00.000Z",
  });
  const repost = adapter.generateGroupKey({
    company: "Acme",
    title: "Nurse",
    location: "Delhi, IN",
    postedAt: "2026-10-22T00:00:00.000Z",
  });
  const anotherRole = adapter.generateGroupKey({
    company: "Acme",
    title: "Accountant",
    location: "Delhi, IN",
    postedAt: "2026-10-01T00:00:00.000Z",
  });
  assert.notEqual(first, repost);
  assert.notEqual(first, anotherRole);
});

test("Remote OK normalizes stable ID, canonical link, and transparent source attribution", () => {
  const job = normalizeRemoteOkJob({
    id: 123,
    position: "Backend Engineer",
    company: "Acme",
    url: "https://remoteok.com/l/123",
    tags: ["Node"],
    description: "<p>Build APIs</p>",
  });
  assert.equal(job.sourceJobId, "123");
  assert.equal(job.canonicalUrl, "https://remoteok.com/l/123");
  assert.equal(job.rawDescription, "Build APIs");
  assert.equal(normalizeRemoteOkJob({ id: 0, position: "", company: "" }), null);
});

test("Remotive normalizes active feed fields and strips source HTML", () => {
  const job = normalizeRemotiveJob({
    id: 7,
    title: "Designer",
    company_name: "Acme",
    url: "https://remotive.com/jobs/7",
    candidate_required_location: "Worldwide",
    description: "<p>Design</p><script>bad()</script>",
  });
  assert.equal(job.sourceJobId, "7");
  assert.equal(job.structuredLocation.remoteScope, "unknown");
  assert.equal(job.rawDescription, "Design");
});

test("Jobicy maps documented salary fields and preserves unknown pay units", () => {
  const yearly = normalizeJobicyJob({
    id: 12,
    jobTitle: "Engineer",
    companyName: "Acme",
    url: "https://jobicy.com/jobs/12",
    salaryMin: 90000,
    salaryMax: 120000,
    salaryCurrency: "USD",
    salaryPeriod: "yearly",
    pubDate: "2026-10-01T00:00:00Z",
    jobDescription: "<p>Build</p>",
  });
  assert.equal(yearly.compensation.min, 90000);
  assert.equal(yearly.compensation.payPeriod, "year");
  assert.equal(yearly.rawDescription, "Build");
  const unknown = normalizeJobicyJob({
    id: 13,
    jobTitle: "Engineer",
    companyName: "Acme",
    url: "https://jobicy.com/jobs/13",
  });
  assert.equal(unknown.compensation.min, null);
  assert.equal(unknown.compensation.payPeriod, "unknown");
  assert.equal(unknown.sourceExpiresAt, null, "missing posted dates are not fabricated");
  assert.equal(unknown.postedAt, null);
});

test("source descriptions discard active HTML and bound stored text", () => {
  assert.equal(sourceDescriptionText("<h1>A</h1><img src=x onerror=alert(1)><p>B</p>"), "A\nB");
  assert.equal(sourceDescriptionText("x".repeat(25000)).length, 24000);
});

test("only approved source policies with full terms metadata are eligible", () => {
  assert.deepEqual(
    SOURCE_POLICIES.filter((source) => source.approved && source.enabled).map(({ key }) => key),
    ["remoteok"],
  );
  assert.equal(SOURCE_POLICIES.find((source) => source.key === "jobicy").approved, true);
  assert.equal(
    SOURCE_POLICIES.find((source) => source.key === "jobicy").enabled,
    false,
    "Jobicy stays disabled by default until explicit operator enablement",
  );
  assert.ok(
    SOURCE_POLICIES.filter((source) =>
      ["greenhouse", "lever", "ashby", "adzuna-india"].includes(source.key),
    ).every((source) => !source.approved && !source.enabled),
  );
  assert.ok(SOURCE_POLICIES.every(isSourcePolicyComplete));
  assert.equal(
    isSourceActivationAllowed(SOURCE_POLICIES.find((source) => source.key === "adzuna-india")),
    false,
  );
  assert.equal(
    isSourceActivationAllowed({
      key: "adzuna-india",
      commercialLicenseReference: "license",
      attributionBadgeVerified: true,
      storageDisplayTermsReviewed: true,
    }),
    true,
  );
  assert.equal(
    isSourceActivationAllowed(SOURCE_POLICIES.find((source) => source.key === "remotive")),
    false,
  );
  assert.equal(isSourceActivationAllowed({ key: "remotive" }), false);
  assert.equal(
    isSourceActivationAllowed({
      key: "remotive",
      writtenRedistributionPermissionReference: "signed permission",
    }),
    true,
  );
  assert.equal(
    isSourceActivationAllowed(SOURCE_POLICIES.find((source) => source.key === "jobicy")),
    true,
  );
  assert.equal(
    isSourcePolicyComplete({
      key: "new",
      approved: false,
      enabled: false,
      quota: { requestsPerDay: 1 },
    }),
    false,
  );
});

test("public ATS adapters normalize fixture postings and only retain Ashby-listed postings", () => {
  const greenhouse = normalizePublicAtsJob("greenhouse", "acme", {
    id: 4,
    title: "Nurse",
    absolute_url: "https://boards.greenhouse.io/acme/jobs/4",
    location: { name: "Kochi" },
    content: "Care",
  });
  const lever = normalizePublicAtsJob("lever", "acme", {
    id: "5",
    text: "Engineer",
    hostedUrl: "https://jobs.lever.co/acme/5",
    categories: { location: "India" },
    descriptionPlain: "Build",
  });
  const ashby = normalizePublicAtsJob("ashby", "acme", {
    id: "6",
    title: "Designer",
    jobUrl: "https://jobs.ashbyhq.com/acme/6",
    isListed: true,
    descriptionPlain: "Design",
  });
  assert.equal(greenhouse.sourceJobId, "4");
  assert.equal(lever.location, "India");
  assert.equal(ashby.title, "Designer");
  assert.equal(
    normalizePublicAtsJob("ashby", "acme", { id: "7", title: "Private", isListed: false }),
    null,
  );
});

test("Adzuna normalizer retains attribution source and does not invent salary period", () => {
  const job = normalizeAdzunaJob({
    id: "a1",
    title: "Care Assistant",
    redirect_url: "https://www.adzuna.in/details/1",
    salary_min: 300000,
    salary_max: 500000,
    company: { display_name: "Care Co" },
  });
  assert.equal(job.attributionText, "Adzuna");
  assert.equal(job.compensation.payPeriod, "unknown");
});

test("company tracking only accepts exact public ATS career hosts and safe slugs", () => {
  assert.deepEqual(detectAtsCareersUrl("https://jobs.lever.co/acme"), {
    platform: "lever",
    slug: "acme",
    careersUrl: "https://jobs.lever.co/acme",
  });
  assert.equal(detectAtsCareersUrl("https://evil.example/?url=https://jobs.lever.co/acme"), null);
  assert.equal(detectAtsCareersUrl("https://jobs.lever.co/acme/redirect"), null);
  assert.equal(detectAtsCareersUrl("http://jobs.ashbyhq.com/acme"), null);
});

test("company board verification rejects redirects and responses above its byte cap", async () => {
  const board = { platform: "lever", slug: "acme" };
  assert.equal(
    await verifyPublicBoard(
      board,
      async () => new Response("", { status: 302, headers: { location: "https://evil.example" } }),
    ),
    false,
  );
  assert.equal(
    await verifyPublicBoard(
      board,
      async () => new Response("{}", { status: 200, headers: { "content-length": "2000001" } }),
    ),
    false,
  );
  assert.equal(await verifyPublicBoard(board, async () => new Response('{"postings":[]}')), true);
});

test("source registry module names load adapters from the bounded local adapter directory", async () => {
  const adapter = await jobIngestionService.getAdapter(
    SOURCE_POLICIES.find((source) => source.key === "remotive"),
  );
  assert.equal(adapter.name, "remotive");
  assert.equal(typeof adapter.fetchPage, "function");
  assert.equal(adapter.capabilities.demandSearch, true);
});

test("source HTTP retries are bounded to 429/5xx and never retry abort timeouts", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const adapter = new BaseJobAdapter({ key: "retry-test", maxRetries: 1 });
  let requests = 0;
  let quotaReservations = 0;
  adapter.consumeQuota = async () => {
    quotaReservations += 1;
  };
  globalThis.fetch = async () => {
    requests += 1;
    return requests === 1
      ? new Response("busy", { status: 503 })
      : new Response('{"ok":true}', { status: 200 });
  };
  const result = await adapter.requestJson("https://example.test/feed");
  assert.deepEqual(result.data, { ok: true });
  assert.equal(requests, 2);
  assert.equal(quotaReservations, 2, "every actual request consumes one quota unit");

  requests = 0;
  quotaReservations = 0;
  globalThis.fetch = async () => {
    requests += 1;
    const error = new Error("timeout");
    error.name = "AbortError";
    throw error;
  };
  await assert.rejects(adapter.requestJson("https://example.test/feed"), { name: "AbortError" });
  assert.equal(requests, 1);
  assert.equal(quotaReservations, 1);
});
