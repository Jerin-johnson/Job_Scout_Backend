# AI mock interviews (Phase 1)

Phase 1 provides a text-only, resume-grounded interview flow. Sessions and transcripts are persisted in MongoDB. Resume records and every session, message, report, and deletion query are scoped to the authenticated user. Resume listing returns metadata only; encrypted resume text is decrypted server-side only for question generation.

## API

All endpoints require authentication. Mutating endpoints also use the existing CSRF protection.

| Method   | Path                                            | Purpose                                                                                                                                              |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/profile/resumes`                       | List owned resume metadata (no raw text or file contents)                                                                                            |
| `GET`    | `/api/v1/interview/modes`                       | Return interview modes and active consent version                                                                                                    |
| `GET`    | `/api/v1/interview/sessions?page=1&limit=20`    | List owned sessions, newest first                                                                                                                    |
| `POST`   | `/api/v1/interview/sessions`                    | Create a session; accepts `resumeId`, `role`, `level`, `mode`, `durationMinutes`, optional `jobDescription`, and `{consent:{accepted:true,version}}` |
| `POST`   | `/api/v1/interview/sessions/:id/start`          | Start the session clock and return the first question; repeat calls return the current prompt                                                        |
| `POST`   | `/api/v1/interview/sessions/:id/answers`        | Submit `{answer,source?,audioDurationMs?,startedAtMs?}` and an `Idempotency-Key` header                                                              |
| `POST`   | `/api/v1/interview/sessions/:id/answers/stream` | Same idempotent answer contract; streams next-question text as SSE `token` events and a final `done` result                                          |
| `POST`   | `/api/v1/interview/sessions/:id/complete`       | Create or return the one report associated with the session                                                                                          |
| `PATCH`  | `/api/v1/interview/sessions/:id/pin`            | Pin or unpin a session to control automatic retention                                                                                                |
| `GET`    | `/api/v1/interview/sessions/:id`                | Get owned session metadata and ordered transcript                                                                                                    |
| `GET`    | `/api/v1/interview/sessions/:id/report`         | Read the saved report                                                                                                                                |
| `DELETE` | `/api/v1/interview/sessions/:id`                | Delete the session, transcript, and report                                                                                                           |

The existing prep, mock-turn, and legacy report APIs remain available. Legacy mock sessions remain process-local; their turn and report endpoints now verify the owning user. New clients should use the durable session routes.

## Lifecycle and safety

Allowed status transitions are `ready → in_progress → completed`, `ready → cancelled`, and `in_progress → expired|cancelled`. The server records the start and end timestamps and refuses answers after the configured duration. The client countdown is informational; the server clock is authoritative.

Candidate answers are limited to 4,000 characters and require an idempotency key. The key is bound to a hash of the request; a replay with the same content returns its stored response, while a different body returns 422. The unique indexes on `(interviewId, sequence)` and `(interviewId, idempotencyKey)` prevent duplicate messages. Per-question claims expire and are released when persistence or evaluation fails. Reports are Zod-validated, retried once when provider output is invalid, and protected by a unique `interviewId` index. Fallback reports are marked and may be regenerated. A report requires at least two completed answers.

Each session stores the server-side consent timestamp and consent version. Transcripts and reports are automatically deleted after `MOCK_INTERVIEW_RETENTION_DAYS` (default 90) unless the user pins the session. Users can also delete a session immediately. Consent explains this retention. Phase 1 sends text only; it does not record or store audio/video. Message fields `source`, `audioDurationMs`, and `startedAtMs` are reserved for the planned audio phase.

Session token accounting uses conservative estimates from prompt text plus reserved model output tokens. It caps planned model work per session; provider-wide actual token/cost telemetry remains in the existing usage system.

## Interview quality and model cost

`MOCK_INTERVIEW_QUESTION_TIER` and `MOCK_INTERVIEW_EVALUATION_TIER` default to `small`; `MOCK_INTERVIEW_REPORT_TIER` defaults to `strong`. They accept `small` or `strong` and resolve through the shared provider catalog, so deployments can tune cost without embedding provider model names in interview code. The report model generates evidence-linked answer reviews, an explicitly labeled practice answer, prioritized actions, resume suggestions, and a seven-day practice plan. Scores are checked against the selected mode rubric and role-family/experience calibration. Generated reports are validated and retried once; a deterministic fallback is clearly identified and can be retried later.

Mode definitions live in `src/shared/constants/interviews.js`; each includes a persona, phase allocation, question strategy, seniority and role-family difficulty guidance, weighted rubric anchors, red flags, and interviewer anti-patterns. `promptVersion` is stored with each session. Changes to a rubric or prompt should increment that version so eval outputs can be compared across releases.

## Verification and evaluation

Run `npm test` for unit tests. Real Mongo concurrency/index integration is in `tests/interview.mongo.integration.test.js`. To execute it, install the optional dev dependency `mongodb-memory-server`, then set `MOCK_INTERVIEW_MONGO_INTEGRATION=true` and run `npm test`; in this environment the package/network was unavailable, so the integration case is present but skipped. The regular unit suite continues to run offline.

Run `npm run eval:interviews` with provider credentials to evaluate 15 synthetic transcripts spanning all five modes, five role families, and seniority levels. It reports schema pass rate, evidence quote grounding, per-mode pass counts, estimated input size, and latency. Use `npm run eval:interviews -- --baseline=path/to/results.json` to compare a saved result from a previous prompt version. Preserve results outside source control if they include any non-synthetic material. Use `npm run interview:usage -- 30` for privacy-safe model, cost, token, and latency aggregates from production usage events. Evaluate prompt edits with the same provider and tier; do not treat synthetic fixtures as a substitute for consented human review.

## Operational and product limits

Phase 1.5 remains text-only. SSE delivers the next prompt after answer evaluation; provider-native token streaming is not yet enabled. Reminder notifications are outside the interview scope. The local assistant can’t provide meaningful before/after live provider latency or cost figures without the same provider, model settings, credentials, and representative workload; compare usage-event aggregates before and after rollout. Phase 2 can add LiveKit audio rooms, consented audio capture, transcription, interruption handling, and a separate audio retention policy while keeping `source`, `audioDurationMs`, and `startedAtMs` on messages.

## Release QA checklist

- Verify consent version acceptance, timezone capture, Premium three-per-day default, and the optional free-trial toggle.
- Exercise two simultaneous submissions, same-key replay, reused-key/different-body rejection, expired-claim recovery, and the 4,000-character limit.
- Confirm another account receives 404 for session, transcript, report, pin, and delete operations.
- Complete with zero/one answer (rejected), two answers (report generated), provider outage (marked fallback), and a later report retry.
- Pin/unpin a session, verify retention dates propagate to all records, and verify deletion removes transcript, report, and related cache entries.
- Check transcript keyboard use, Cmd/Ctrl+Enter, disabled double-submit, SSE interruption recovery, offline state, narrow mobile layout, and screen-reader progress/status labels.
- Run `npm run ensure-indexes` before release and inspect indexes in the target MongoDB environment; test the Mongo concurrency suite when its optional test dependency is available.

Record a baseline and candidate result from the same environment. Do not infer savings from model tier labels alone; use provider usage data.

| Metric                                       | Baseline prompt version         | Candidate prompt version        |
| -------------------------------------------- | ------------------------------- | ------------------------------- |
| Provider and model tier                      | Record during eval              | Record during eval              |
| Mean / p95 answer latency                    | Record from representative runs | Record from representative runs |
| Mean report latency                          | Record from representative runs | Record from representative runs |
| Mean cost per session                        | `interview:usage` aggregate     | `interview:usage` aggregate     |
| Fixture schema / grounded evidence pass rate | Eval JSON                       | Eval JSON                       |

## Plans and configuration

- Premium sessions: `MOCK_INTERVIEW_PREMIUM_DAILY_LIMIT` (default `3`).
- Per-session estimated token cap: `MOCK_INTERVIEW_SESSION_TOKEN_CAP` (default `12000`).
- Optional one-session free trial for non-Premium accounts: `MOCK_INTERVIEW_FREE_TRIAL_ENABLED` (default `false`). Trial use is claimed atomically on the Mongo user record when the interview starts. Redis is not the source of truth for this quota.
- Daily session quota is consumed at start, not during setup. The quota day uses the user's IANA timezone (captured by the client on start, then persisted to their user record). MongoDB atomically enforces the per-user daily limit.
- Session durations: 10, 20, or 30 minutes.

The existing shared `invokeLLM` and provider selection are reused. No provider-specific interview SDK or new dependency is added. Free-trial LLM calls use the existing daily AI budget checks and are recorded as `mock_interview_trial` usage events.

## MongoDB rollout

No SQL migration is needed. Models add the `interviewsessions`, `interviewmessages`, and `interviewreports` collections. Before deploying to production, run `npm run ensure-indexes`; it creates the owner/history, unique sequence, unique idempotency key, one-report-per-session, and TTL indexes, and backfills expiration dates on existing interview data. The app deliberately requires MongoDB for creating sessions. Deleting an account also deletes its interview records; the privacy export includes transcripts and reports.

## Verification

Run `npm test` for focused ownership, state-transition, quota, idempotency-index metadata, Phase 2 message metadata, and report-schema tests. Run `npm run lint` and `npm run format` for backend code checks. `npm run openapi` regenerates `openapi.json` after API changes.
