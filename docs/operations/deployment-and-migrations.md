# Deployment and migrations

Deploy the API and worker from the same backend release. Configure the frontend's API base URL to the backend origin and allow that origin in `WEB_ORIGIN`. Set `NODE_ENV=production`, real required secrets, provider credentials/models accepted by the model catalog, and Redis/Mongo URLs. See [environment variables](environment-variables.md).

Before deploying a schema/index change, inspect the additive model/index update and take a database backup. `npm run ensure-indexes` synchronizes indexes from Mongoose models. For the job catalog, `npm run jobs:migrate:report` previews changes; `npm run jobs:migrate:apply` applies the migration; `npm run jobs:migrate:rollback` rolls back only the additive catalog metadata migration where its rollback guards permit. Read `docs/JOB_CATALOG_INGESTION.md` and the script output before applying either command. Do not run these against production without an approved change window and backup.

**Content hash / identity:** current job identity uniqueness is enforced by `job_identity_unique` on `identityKey`; migration reporting and rollback are implemented in `scripts/migrate-job-catalog.js`. No migration was run for this documentation task. Verify duplicate identity handling with `npm run jobs:migrate:report` against a copy before deployment.

Resume cleanup is report-only by default. `npm run resumes:cleanup-report` shows candidates; deletion requires the explicit configuration flag and the configured retention age. Never enable deletion before reviewing the report.
