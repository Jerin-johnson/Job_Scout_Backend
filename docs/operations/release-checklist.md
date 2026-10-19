# First production release checklist

This is a guarded runbook. Do not point these commands at production until the owner has reviewed the exact database, branch, and change window.

## Merge order

1. Merge `feat/jobs-phase-3` from `AiJob_search_backend` to the backend production branch.
2. Deploy the backend, validate health/readiness and the API contract, then run the worker with the same configuration.
3. Merge `feat/jobs-phase-3` from `Ai_resume_frontend` and deploy the frontend after the backend is ready.
4. Keep both branches and commit hashes in the release record. Do not merge either repository's Git history into the other.

## Environment and services

- Set `FX_REFERENCE_SOURCE=ecb`; `rbi` and `fbil` are not active adapters. FBIL usage requires license review.
- Set the backend credentials/configuration from `docs/ENVIRONMENT_SETUP.md`; never copy local `.env` values into a ticket or release log.
- Set the frontend API origin to the production backend origin and verify CORS/CSP allow only the intended app origin and S3 bucket.
- Run API and BullMQ worker as separate process roles. Worker requires MongoDB and Redis. Set Redis `maxmemory-policy noeviction`; confirm persistent availability, queue monitoring, and credentials.
- Keep source enablement flags off except for approved feeds. ATS company records must be individually admin-approved; Adzuna remains blocked on license.
- Jobicy and Remotive are disabled by default; never enable Remotive without written redistribution permission. Jobicy's 24/day request ceiling is an application budget (not a published provider quota) and its sync starts must remain at least one hour apart.
- Job interaction analytics are opt-in only. Verify the UI consent/version, export and account-deletion behavior, and 180-day TTL before enabling event reports.
- Review [production config](./production-config-checklist.md), verify `/health/live` and `/health/ready`, confirm Sentry redaction, and rehearse [backup/restore](./backup-restore.md) on an isolated local/staging stack.
- Review feedback retention/export/deletion and admin analytics caveats. Feedback text is not included in admin views.

## Catalog rollout and guarded database steps

1. Take a database backup and confirm restore access.
2. Review the production query plan for active catalog discovery and confirm expected indexes before changing records.
3. Run the eligibility report command against the intended local/staging copy first: `npm run jobs:eligibility:report`.
4. Review source/scope deltas and evidence samples. Production writes are intentionally not provided by the local-only `jobs:eligibility:apply` command. Prepare a separate, reviewed, batched deployment command with an explicit environment/database allowlist before any production backfill.
5. Never run `jobs:ats:import`, `jobs:eligibility:apply`, or a manual source enablement against production without separate review and approval.
6. Review `docs/ai/jobs-scale.md` and `docs/ai/scale-research.md`; keep a source disabled until its license/terms, attribution, retention, request budget and verification date are recorded and its complete adapter has a fixture and failure test.
7. Review `npm run jobs:storage:report` before applying the additive storage split. Keep legacy detail/vector fields until both new reads and rollback are verified.
8. Capture the local-only scale benchmark output and explain plans before selecting production database/worker capacity. Synthetic results are not a production sizing promise.

## Smoke checks

- API `/health/live` and `/health/ready`; worker heartbeat and Redis queue health.
- Login/session refresh, resume completion from a presigned S3 upload, career profile save, Jobs catalog search, deterministic match refresh, application tracking, and admin source approval/disable.
- Confirm no resume text, credentials, cookies, or presigned URL appears in logs.
- Confirm a job card shows source and date; without a home country the Jobs page offers a link to the Career profile and unknown eligibility is labeled clearly.
- Confirm Jobs uses the keyset cursor contract and a non-exhaustive source notice; do not claim full-web coverage or show unverified cross-source variants.
- Verify error tracking receives request IDs but no prompt, resume, or secret payloads.
- Check that admin coverage metrics distinguish measured local catalog counts from source-wide yield. JobStream live yield, government-feed rights, reference-data imports, and labeled occupation precision/recall remain unverified until their evidence gates pass.

## Rollback

- Roll back frontend and backend to the recorded preceding release in their own repositories.
- Keep additive eligibility fields; reverting code makes the legacy fields and v2 matcher available. The backfill is reversible by setting `eligibility.version` back to an older version only after a reviewed backup and recovery plan; do not blanket-overwrite newer values.
- Turn off a source via its existing admin disable and `ENABLE_<SOURCE>_INGESTION=false` flag, then reconcile worker schedules.
- Do not delete or rewrite legacy embeddings during rollback. Any removal/relocation requires a separately approved, reversible migration.
