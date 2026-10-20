import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  JobStreamAdapter,
  normalizeJobStreamEvent,
  parseJsonLines,
} from "../src/infrastructure/external-services/jobs/adapters/jobStreamAdapter.js";
import { NavJobFeedAdapter } from "../src/infrastructure/external-services/jobs/adapters/navAdapter.js";
import {
  FranceTravailAdapter,
  normalizeFranceTravailOffer,
} from "../src/infrastructure/external-services/jobs/adapters/franceTravailAdapter.js";
import {
  SOURCE_POLICIES,
  isSourcePolicyComplete,
} from "../src/domain/services/jobs/sourcePolicies.js";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/regional-source-adapters.json", import.meta.url), "utf8"),
);

test("regional sources have complete policy records and remain disabled pending approval", () => {
  for (const key of ["jobstream-se", "nav-no", "france-travail"]) {
    const policy = SOURCE_POLICIES.find((entry) => entry.key === key);
    assert.ok(policy);
    assert.equal(isSourcePolicyComplete(policy), true);
    assert.equal(policy.approved, false);
    assert.equal(policy.enabled, false);
  }
  const jobicy = SOURCE_POLICIES.find((entry) => entry.key === "jobicy");
  assert.equal(jobicy.quota.intervalMs, 3600000);
  assert.equal(jobicy.retentionDays, 7);
});

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("JobStream parses JSONL incrementally across chunk and line boundaries", async () => {
  const jsonl = `${fixture.jobStreamSnapshot.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const bytes = Buffer.from(jsonl);
  const chunks = [bytes.subarray(0, 7), bytes.subarray(7, 53), bytes.subarray(53)];
  const parsed = [];
  for await (const row of parseJsonLines(Readable.from(chunks))) parsed.push(row);
  assert.deepEqual(parsed, fixture.jobStreamSnapshot);
  await assert.rejects(async () => {
    for await (const unused of parseJsonLines(Readable.from([Buffer.from("{broken}\n")])))
      void unused;
  }, /Invalid JobStream JSONL at line 1/);
});

test("JobStream normalizes snapshot job and emits explicit update/delete events", async () => {
  const snapshot = normalizeJobStreamEvent(fixture.jobStreamSnapshot[0]);
  assert.equal(snapshot.type, "upsert");
  assert.equal(snapshot.job.structuredLocation.countryCode, "SE");
  assert.equal(snapshot.job.company, "Region Stockholm");
  const [updated, removed] = fixture.jobStreamChanges.map(normalizeJobStreamEvent);
  assert.equal(updated.type, "upsert");
  assert.equal(updated.cursor, "2026-10-12T08:00:00.000Z");
  assert.equal(removed.type, "delete");
  assert.equal(removed.sourceJobId, "se-2");
  assert.equal(removed.cursor, "2026-10-12T09:00:00.000Z");
});

test("JobStream fetchPage exposes one-pass async events and bounded ISO cursor window", async () => {
  const lines = fixture.jobStreamChanges.map((event) => JSON.stringify(event)).join("\n");
  let requestUrl;
  const adapter = new JobStreamAdapter({
    changesUrl: "https://jobstream.invalid/v2/changes",
    fetchImpl: async (url) => {
      requestUrl = new URL(url);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from(lines));
            controller.close();
          },
        }),
        { status: 200 },
      );
    },
  });
  const page = await adapter.fetchPage({ cursor: "2026-10-11T00:00:00.000Z" });
  assert.equal(page.done, true);
  assert.ok(page.events[Symbol.asyncIterator]);
  const events = [];
  for await (const event of page.events) events.push(event);
  assert.deepEqual(
    events.map(({ type, sourceJobId }) => ({ type, sourceJobId })),
    [
      { type: "upsert", sourceJobId: "se-1" },
      { type: "delete", sourceJobId: "se-2" },
    ],
  );
  assert.equal(page.cursor, "2026-10-12T09:00:00.000Z");
  assert.equal(requestUrl.searchParams.get("updated-after"), "2026-10-11T00:00:00.000Z");
  assert.ok(requestUrl.searchParams.get("updated-before"));
});

test("NAV adapter authenticates with bearer token and returns inactive IDs immediately", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const seenHeaders = [];
  globalThis.fetch = async (_url, options) => {
    seenHeaders.push(options.headers);
    return response(fixture.nav);
  };
  const adapter = new NavJobFeedAdapter({
    feedUrl: "https://nav.invalid/feed",
    token: "fixture-token",
  });
  const page = await adapter.fetchPage({ cursor: "nav-cursor-1" });
  assert.equal(seenHeaders[0].Authorization, "Bearer fixture-token");
  assert.equal(page.jobs.length, 1);
  assert.equal(page.jobs[0].structuredLocation.countryCode, "NO");
  assert.equal(page.jobs[0].sourceUrl, "https://arbeidsplassen.nav.no/stillinger/stilling/no-1");
  assert.deepEqual(page.inactiveIds, ["no-2"]);
  assert.equal(page.cursor, "nav-cursor-2");
  assert.equal(page.done, false);
});

test("NAV refuses missing auth before any request", async () => {
  const adapter = new NavJobFeedAdapter({ feedUrl: "https://nav.invalid/feed", token: "" });
  await assert.rejects(adapter.fetchPage(), { code: "NAV_FEED_TOKEN_MISSING" });
});

test("France Travail normalizes only active offers and strips contact data", () => {
  const [offer, closed] = fixture.franceTravail.firstPage;
  const normalized = normalizeFranceTravailOffer(offer);
  assert.equal(normalized.structuredLocation.countryCode, "FR");
  assert.equal(normalized.company, "Hôpital Exemple");
  assert.match(normalized.rawDescription, /\[contact removed\]/);
  assert.doesNotMatch(normalized.rawDescription, /contact@example\.fr|\+33 1 23/);
  assert.equal("contact" in normalized, false);
  assert.equal(normalizeFranceTravailOffer(closed), null);
});

test("France Travail obtains and caches OAuth token, pages offers, and never sends contacts", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests = [];
  let offerCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(url);
    requests.push({ url: requestUrl, options });
    if (requestUrl.hostname === "auth.invalid")
      return response({ access_token: "fixture-access-token", expires_in: 3600 });
    offerCalls += 1;
    return response(
      offerCalls === 1 ? fixture.franceTravail.firstPage : fixture.franceTravail.secondPage,
    );
  };
  const adapter = new FranceTravailAdapter({
    tokenUrl: "https://auth.invalid/token",
    offersUrl: "https://offers.invalid/search",
    clientId: "fixture-id",
    clientSecret: "fixture-secret",
    scope: "fixture-scope",
    pageSize: 2,
  });
  const first = await adapter.fetchPage({ demandTerm: "nursing" });
  const second = await adapter.fetchPage({ cursor: first.cursor });
  assert.equal(requests.length, 3, "OAuth token is cached across pages");
  assert.equal(requests[1].options.headers.Authorization, "Bearer fixture-access-token");
  assert.equal(requests[1].options.headers.Range, "0-1");
  assert.equal(requests[1].url.searchParams.get("motsCles"), "nursing");
  assert.equal(first.jobs.length, 1, "closed offers are discarded");
  assert.equal(first.done, false);
  assert.equal(second.jobs[0].sourceJobId, "fr-2");
  assert.equal(second.done, true);
  assert.equal(second.cursor, null);
  assert.equal(requests[0].options.body.includes("fixture-secret"), true);
});

test("France Travail fails closed when OAuth configuration is absent", async () => {
  const adapter = new FranceTravailAdapter({
    offersUrl: "https://offers.invalid/search",
    clientId: "",
    clientSecret: "",
    tokenUrl: "",
  });
  await assert.rejects(adapter.fetchPage(), { code: "FRANCE_TRAVAIL_OAUTH_NOT_CONFIGURED" });
});
