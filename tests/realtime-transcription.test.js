import test from "node:test";
import assert from "node:assert/strict";
import { createRealtimeTranscriptionCredential } from "../src/infrastructure/interview/realtimeTranscriptionService.ts";
import { authenticate } from "../src/presentation/http/middleware/auth.ts";
import { transcriptionSessionSchema } from "../src/shared/schemas/interviewSchemas.ts";

test("creates a short-lived transcription-only credential with fixed model", async () => {
  let request;
  const credential = await createRealtimeTranscriptionCredential("user-123", {
    apiKey: "server-only-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          value: "ephemeral-secret",
          expires_at: 123456,
          session: { id: "rt-session" },
        }),
      };
    },
  });
  assert.equal(request.url, "https://api.openai.com/v1/realtime/client_secrets");
  assert.equal(request.options.headers.Authorization, "Bearer server-only-key");
  assert.equal(request.options.headers["OpenAI-Safety-Identifier"].length, 64);
  assert.equal(request.options.headers["OpenAI-Safety-Identifier"].includes("user-123"), false);
  const body = JSON.parse(request.options.body);
  assert.equal(body.expires_after.seconds, 60);
  assert.deepEqual(body.session, {
    type: "transcription",
    audio: {
      input: {
        transcription: { model: "gpt-live-transcribe", delay: "low" },
        turn_detection: null,
      },
    },
  });
  assert.deepEqual(credential, {
    credential: "ephemeral-secret",
    expiresAt: 123456,
    sessionId: "rt-session",
  });
});

test("does not call OpenAI when permanent key is missing or placeholder", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
  };
  await assert.rejects(
    createRealtimeTranscriptionCredential("u", { apiKey: "replace-me", fetchImpl }),
    { statusCode: 503 },
  );
  assert.equal(calls, 0);
});

test("provider failures return safe errors without response body details", async () => {
  await assert.rejects(
    createRealtimeTranscriptionCredential("u", {
      apiKey: "server-only-key",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: "secret detail" }),
      }),
    }),
    (error) => error.statusCode === 503 && !error.message.includes("secret detail"),
  );
});

test("transcription credential request requires explicit consent and rejects config overrides", () => {
  assert.deepEqual(transcriptionSessionSchema.parse({ consentAccepted: true }), {
    consentAccepted: true,
  });
  assert.equal(transcriptionSessionSchema.safeParse({ consentAccepted: false }).success, false);
  assert.equal(
    transcriptionSessionSchema.safeParse({ consentAccepted: true, model: "other-model" }).success,
    false,
  );
});

test("authentication middleware rejects an anonymous credential request", async () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await authenticate({ headers: {}, cookies: {}, id: "request-test" }, response, () => {
    assert.fail("anonymous request must not proceed");
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
});
