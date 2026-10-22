# Interview live transcription

Last verified against commit: local `feat/interview-live-transcription` working tree, 2026-10-21.

## As built (verified in code)

The interview answer composer can optionally capture speech and place a live transcript in the existing editable answer field. It is transcription only: evaluation continues to receive the final text through the existing answer endpoint. Audio does not pass through JobScout servers or S3.

## Security and configuration

- The backend uses the existing server-only `OPENAI_API_KEY`. Do not add it to any `NEXT_PUBLIC_` variable or frontend environment file.
- `POST /api/v1/interview/sessions/:id/transcription-session` is authenticated, CSRF-protected, owner-scoped, limited to an active interview with current-version interview consent, subject to the interview quota check, and rate-limited to 5 credential requests per account per 15 minutes using the existing Redis-backed limiter. If Redis rate-limit storage errors, this endpoint fails closed.
- The server fixes the session to OpenAI Realtime transcription with `gpt-live-transcribe`, low-delay output, client-side turn detection, and a 60-second client credential. The browser cannot choose a model or session configuration.
- The browser sends microphone audio directly to OpenAI over WebRTC. JobScout does not proxy or persist audio. Users must opt in to live transcription separately from interview AI-processing consent.
- No transcript, audio, API key, or ephemeral credential is logged. The backend sends a SHA-256 pseudonymous safety identifier instead of the account ID.
- The UI stops capture after 15 minutes and releases microphone tracks and the peer connection on stop or navigation. The backend limits credential issuance; the provider credential itself expires after 60 seconds, so a client must establish the session promptly.

## Local setup and troubleshooting

Set the existing `OPENAI_API_KEY` in the backend's local environment to a valid OpenAI API key with Realtime access. Restart the backend. No new environment variables, dependencies, database fields, storage, or worker jobs are required. Without a valid server key, the UI remains usable for typed answers and reports that live transcription is unavailable.

Allow microphone access for the local frontend origin. If the browser or network blocks WebRTC, the existing textbox remains editable and the user can retry or type an answer. The browser uses local Web Audio level detection to commit speech turns after pauses; only finalized transcript segments are included when stopping. An unfinished interim segment is removed unless the user manually edited it.

## Endpoint

`POST /api/v1/interview/sessions/:id/transcription-session`

Request: `{ "consentAccepted": true }`

Success data: `{ "credential": "<short-lived client credential>", "expiresAt": <unix timestamp>, "sessionId": "<provider session id>" }`

The endpoint returns no permanent provider credential or audio. Call it only after the user explicitly enables microphone transcription.

## Target design (not built yet)

No future architecture change is required. Future latency or language adjustments should remain fixed server configuration and be evaluated with representative speech before rollout.
