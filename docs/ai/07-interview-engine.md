# 07 — Mock interview engine

## Rapid stack quiz (separate lightweight flow)

`POST /api/v1/interview/quiz/session` requires an owned, successfully parsed resume with usable extracted skill or role facts and an explicit role or owned tracked-application focus. It derives a 3–5 question pack from normalized structured resume facts and, when available, the selected job description through `invokeLLM` at the small tier. It does not send raw resume text. Questions are validated before use; recent saved questions are supplied as exclusions and repeated questions are rejected rather than replaced with generic content. If generation fails, the user receives a retryable error. Answer keys and scoring rubrics stay server-side in the user-scoped 30-minute Redis session and durable Mongo attempt; the client receives questions only. MCQs are scored exactly, and scenario answers use the generated rubric. Incorrect answers receive the reference answer and explanation.

The old single-question endpoint is retired with `410 QUIZ_SESSION_REQUIRED`, and answer submission requires a session ID so no client can bypass the resume and focus gate. Quiz history offers an owner-scoped re-practice action that clones the saved question pack into a fresh answer session. New attempts retain their private scoring rubrics for that purpose. Legacy attempts without a rubric use only their stored reference answer and explanation. The quiz UI plays short locally generated Web Audio tones for MCQ feedback; no sound asset or audio data is transmitted.

### Personal quiz history

`QuizAttempt` is the durable, user-owned record for a rapid quiz. It stores the bounded 3–5 question pack, each submitted text/selected option, the evaluation and reference answer, and status/timestamps. The Mongo document is intentionally a single bounded aggregate so one answer update is atomic and duplicate submissions cannot append duplicate answers. The user ID is taken from authenticated server state on every read/delete; detail and delete queries always include both `userId` and `quizSessionId`. History reads are paginated (10 default, 20 maximum); detail returns only answered questions so server-side reference answers for unanswered questions are never exposed. `DELETE /api/v1/interview/quiz/history/:id` removes the Mongo record and its short-lived Redis session. These records remain until the user deletes them; the UI confirms deletion and reports success/failure.

The collection's two indexes are created by the usual `npm run ensure-indexes` step: unique `(userId, quizSessionId)` for idempotency and `(userId, createdAt desc)` for history pagination. No backfill is possible for old quiz answers: the earlier implementation retained question/evaluation data only in Redis for 30 minutes and did not persist the user's submitted text. Active Redis sessions can be adopted when they are next submitted, but any pre-deployment answer text is irrecoverable. No audio is stored; only the text sent to the existing answer endpoint is retained.

This follows MongoDB's single-document atomicity for answer writes and OWASP's recommendation to enforce object-level authorization for each operation. See [MongoDB atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/) and [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

Rapid quiz packs are persisted in `QuizAttempt` for user history and re-practice; the active answer-key cache expires after 30 minutes. Existing points and streak progress continue to be written to the profile. See `stack-quiz-v1` in the [prompt registry](04-prompt-registry.md).

Last verified against commit history on 2026-10-22; no implementation commit was created, so this verification describes the working tree. Runtime Mongo integration checks were not available in this environment.

## As built (verified in code)

src/services/interview/sessionService.js creates sessions for a user-owned resume, records consent timestamp/version, prompt/schema versions, enforces token cap/report reserve, and creates a question plan with deterministic fallback. Answers use idempotency, sequence numbers, a status state machine, and server-side time enforcement. Evaluation uses a bounded transcript and strict Zod schema with fallback. Completion is idempotent, validates the report schema with retry, and stores one report per session. Session retention defaults to 90 days.

Modes/tier config live in src/shared/constants/interviews.js. Premium default is 3 starts/day, free trial disabled, token cap 12,000, retention 90 days; question/evaluation tiers default small and report strong. Provider calls use invokeLLM and record UsageEvent.

## Target design (not built yet)

Expand evaluation fixtures by role/seniority and compare generated reviews against human-rated examples. Calibrate rubrics and track provider drift. Audio is a separately approved channel; current path is text-based.

**Unverified:** production cleanup schedule and retention compliance beyond schema configuration. Inspect worker schedule and retention audit.
