import { createHash } from "node:crypto";
import { env } from "../../config/env.js";

const OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const CLIENT_SECRET_TTL_SECONDS = 60;

export interface RealtimeTranscriptionCredential {
  credential: string;
  expiresAt: number;
  sessionId: string;
}

interface OpenAIClientSecretResponse {
  value?: unknown;
  expires_at?: unknown;
  session?: { id?: unknown };
}

export interface TranscriptionServiceError extends Error {
  statusCode: number;
  code: string;
}

function serviceError(
  statusCode: number,
  code: string,
  message: string,
): TranscriptionServiceError {
  return Object.assign(new Error(message), { statusCode, code });
}

function hasUsableOpenAIKey(apiKey: string): boolean {
  return Boolean(apiKey.trim()) && !/dummy|replace.?me|your.?key|changeme/i.test(apiKey);
}

export async function createRealtimeTranscriptionCredential(
  userId: string,
  {
    apiKey = env.OPENAI_API_KEY,
    fetchImpl = fetch,
  }: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<RealtimeTranscriptionCredential> {
  if (!userId) throw serviceError(401, "UNAUTHORIZED", "Authentication required");
  if (!hasUsableOpenAIKey(apiKey))
    throw serviceError(
      503,
      "TRANSCRIPTION_UNAVAILABLE",
      "Live transcription is not configured on this server",
    );

  const safetyIdentifier = createHash("sha256").update(userId).digest("hex");
  let response: Response;
  try {
    response = await fetchImpl(OPENAI_CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_SECONDS },
        session: {
          type: "transcription",
          audio: {
            input: {
              transcription: { model: "gpt-live-transcribe", delay: "low" },
              turn_detection: null,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw serviceError(
      503,
      "TRANSCRIPTION_UNAVAILABLE",
      "Live transcription could not connect. Please try again.",
    );
  }

  if (!response.ok)
    throw serviceError(
      503,
      "TRANSCRIPTION_UNAVAILABLE",
      "Live transcription is temporarily unavailable. Please try again.",
    );

  let data: OpenAIClientSecretResponse;
  try {
    data = (await response.json()) as OpenAIClientSecretResponse;
  } catch {
    throw serviceError(
      503,
      "TRANSCRIPTION_UNAVAILABLE",
      "Live transcription returned an invalid session. Please try again.",
    );
  }

  if (
    typeof data.value !== "string" ||
    typeof data.expires_at !== "number" ||
    typeof data.session?.id !== "string"
  ) {
    throw serviceError(
      503,
      "TRANSCRIPTION_UNAVAILABLE",
      "Live transcription returned an invalid session. Please try again.",
    );
  }

  return { credential: data.value, expiresAt: data.expires_at, sessionId: data.session.id };
}
