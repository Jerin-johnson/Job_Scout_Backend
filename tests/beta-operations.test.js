import test from "node:test";
import assert from "node:assert/strict";
import { closeHttpServer } from "../src/config/shutdown.js";
import { redactSentryEvent } from "../src/config/sentry.js";
import { UserFeedback } from "../src/infrastructure/database/mongoose/models/UserFeedbackModel.js";

test("Sentry event redaction drops request payloads and sensitive fields", () => {
  const event = {
    request: {
      url: "https://api.example.test/path?token=secret",
      data: { resume: "private resume" },
      cookies: { session: "cookie" },
      query_string: "q=private",
    },
    extra: { prompt: "private prompt", message: "private feedback", safeCount: 3 },
  };
  const redacted = redactSentryEvent(event);
  assert.equal(redacted.request.url, "https://api.example.test/path");
  assert.equal("data" in redacted.request, false);
  assert.equal("cookies" in redacted.request, false);
  assert.equal(redacted.extra.prompt, "[Filtered]");
  assert.equal(redacted.extra.message, "[Filtered]");
  assert.equal(redacted.extra.safeCount, 3);
  assert.equal(event.extra.prompt, "private prompt", "the source event is not mutated");
});

test("Sentry redaction tolerates malformed request URLs", () => {
  assert.equal(redactSentryEvent({ request: { url: "not a url" } }).request.url, "[Filtered]");
});

test("HTTP shutdown waits for active requests to drain", async () => {
  let drained = false;
  const server = {
    close(callback) {
      setTimeout(() => {
        drained = true;
        callback();
      }, 5);
    },
    closeIdleConnections() {},
  };
  await closeHttpServer(server);
  assert.equal(drained, true);
  await closeHttpServer(null);
});

test("feedback model restricts category and message length", async () => {
  const schema = UserFeedback.schema;
  assert.deepEqual(schema.path("category").enumValues, ["general", "bug", "idea"]);
  assert.equal(schema.path("message").options.minlength, 10);
  assert.equal(schema.path("message").options.maxlength, 2000);
  assert.equal(schema.path("userId").options.required, true);
});
