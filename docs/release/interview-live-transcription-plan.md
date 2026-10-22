# Live voice-to-text implementation plan

## Current behavior

The authenticated interview router protects existing session and answer routes. Answers are validated with Zod, require a safe `Idempotency-Key`, and are evaluated and persisted through `interviewSessionService.answer()`. Session lookup is scoped by authenticated `userId`; `detail()` returns 404 for an unowned session and expires timed-out interviews. The backend already configures `OPENAI_API_KEY` for server-side use and has Redis-backed interview rate-limit middleware. There is no Realtime credential endpoint in the `development` branch baseline.

## Scope and approach

- Add a Zod-validated `POST /api/v1/interview/sessions/:id/transcription-session` route with the existing auth and CSRF middleware plus a dedicated Redis-backed rate limiter.
- Require an owned session in `in_progress`, verify the interview feature/quota policy, then request an OpenAI client secret using the existing server-only `OPENAI_API_KEY`.
- Fix the server configuration to `type: transcription`, `gpt-live-transcribe`, no turn detection, and a short credential TTL. Return only value, expiry, and opaque session ID; never log provider credentials, answers, transcripts, SDP, or raw provider response.
- Keep microphone media direct between browser and OpenAI WebRTC. The existing answer endpoint/evaluation remains unchanged.
- Add service/controller integration behavior tests through existing backend test infrastructure and document the endpoint/configuration.

## Risks and checks

- A generated credential can be used until expiry; restrict issuance to an owned active interview and a bounded per-user request rate.
- Missing placeholder `OPENAI_API_KEY` must produce a safe service-unavailable response, not a provider call.
- OpenAI API errors must be translated to a safe generic error without provider response/body logging.
- No new dependencies, database changes, audio storage, or production writes.

## Task list

- [x] Inspect both repository Git states and preserve the pre-existing dirty checkouts.
- [x] Query existing backend Graphify artifacts; inspect actual interview paths and official Realtime docs.
- [x] Create independent `feat/interview-live-transcription` branches from local `development`.
- [x] Implement the backend credential endpoint, fixed transcription configuration, ownership/consent/quota checks, and bounded rate limit. Add unit and Mongo-backed owner tests.
- [x] Implement frontend transcript synchronization, WebRTC lifecycle/VAD, answer control, accessibility states, and behavior tests.
- [x] Document setup, data flow, consent, and security in both repositories.
- [x] Run targeted checks, update and query both Graphify graphs, and review the diffs.

## Verification limits

- Frontend tests (78), lint, and docs check pass. Backend typecheck/build, lint, architecture check, docs check, and the five focused credential/auth tests pass.
- The full backend suite could not complete cleanly because MongoDB Memory Server could not download its MongoDB binary (`fastdl.mongodb.org` DNS failure); its real-Mongo owner-scoping test is included but remains unverified here. The loopback HTTP auth test is also blocked by the environment denying local sockets.
- The final frontend production build is blocked by Windows `EPERM` while Next.js creates `.next/server/app/dev` under OneDrive. The same source passed an earlier build before later small CSP/UI changes; final build remains unverified.
- No commits, merges, or pushes were made. The feature branches are ready for review.
