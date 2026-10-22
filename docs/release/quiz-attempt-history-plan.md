# Quiz attempt history — plan and task list

## Decision

Persist a bounded 3–5 question rapid-quiz aggregate in MongoDB and keep Redis as the short-lived active-session/idempotency cache. Answers are written once to the question position in the owned attempt document. Authenticated, paginated history endpoints expose only answered questions and let the owner delete the attempt. No dependency, external service, or user data migration is needed.

## Tasks

- [x] Inspect backend/frontend instructions, worktrees, graph, existing quiz flow, and actual persistence behavior.
- [x] Research user-scoped delete authorization, Mongo single-document atomic updates, and browser speech accessibility guidance.
- [x] Add Mongo model/repository, durable answer writes, history/list/detail/delete API, and ensure-index registration.
- [x] Add frontend API contracts, reviewable answer history, inline deletion confirmation, and success/error toasts.
- [x] Run targeted checks; record environment-limited tests honestly.
- [x] Bound personalized question generation and fail fast when MongoDB is unavailable.
- [x] Refresh Graphify for both repositories and parent merged graph.
- [x] Review the task diff and finish integration logs/walkthrough.

## Walkthrough

- Backend typecheck passed. Targeted interview and quiz tests reported 23 passed and 1 optional Mongo integration test skipped. Explicit execution with `QUIZ_ATTEMPT_MONGO_INTEGRATION=true` attempted to start the real Mongo memory server, but its bundled `mongod` terminated with an internal `fassert()` before executing assertions. The full backend test command did not finish within the local run and was stopped; no claim is made that it passed.
- Full backend ESLint reports 217 errors/93 warnings from pre-existing nested `.worktrees/` generated JavaScript. The configured ESLint setup ignores the changed TypeScript files; `tsc --noEmit` is the source check. `scripts/ensure-indexes.js` is updated for deployment/local index creation.
- No schema data migration is required. New records are created as quizzes start; existing quiz data is not modified. Index creation is additive. Users can delete their own attempt and its Redis key.
- Quiz attempts are included in the existing user-data export and are deleted during account erasure along with their active Redis session keys.
- Source review confirms all detail/delete repository queries are scoped by authenticated `userId` and session ID. No quiz answer, transcript, or audio is logged or uploaded separately.
- Graphify refreshed in both repositories; current graphs are backend 3,963 nodes / 8,196 edges and frontend 1,400 nodes / 2,686 edges; the parent graph merged to 5,354 nodes / 10,882 edges.
- Follow-up latency fix: quiz start now checks Mongo readiness before profile or model work; personalized generation has an 8-second cancellation budget and falls back to curated questions. When Mongo is unavailable, stateless legacy scoring avoids a buffered profile read and session-backed submissions fail fast. Focused quiz tests passed 10/10; command duration fell from 21.9s to 11.9s, while test bodies totaled under 30ms. The remaining test process shutdown delay is unresolved.
