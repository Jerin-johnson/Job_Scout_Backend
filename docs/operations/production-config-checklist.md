# Production configuration checklist

Use this before the first production rollout and after provider or storage changes. Startup validators remain authoritative; this is an operator review list.

## Secrets and service URLs

- Set unique random `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `RESUME_ENCRYPTION_KEY`; never reuse local or staging values.
- Set `NODE_ENV=production`, exact HTTPS `WEB_ORIGIN`, and the intended `COOKIE_DOMAIN`.
- Set production `MONGODB_URI` and `REDIS_URL` in a secret manager. Redis must use `maxmemory-policy noeviction` and remain available for BullMQ.
- Configure `S3_BUCKET`, `S3_REGION=ap-south-1` for the current Mumbai bucket, and an IAM role limited to required bucket actions. Confirm CORS allows the exact frontend origins, `PUT`, `Content-Type`, and exposes `ETag`.

## AI, quota, and source switches

- Select `LLM_PROVIDER`, configure its actual credential and catalog-priced model IDs, and configure the selected embedding provider credential/model.
- Keep `AI_ALLOW_MOCKS=false` and `AI_BLOCK_UNPAID_PERSONAL_DATA=true`. Confirm paid/approved data policies for any personal-data path.
- Check positive configured limits: `DAILY_USER_USD_BUDGET`, `GLOBAL_DAILY_USD_CAP`, `AI_PROVIDER_MAX_RETRIES`, and mock-interview limits. Monthly allowance is shadow-only.
- Do not enable Jobicy without the owner-run staging flag/registry approval and visible attribution. Remotive remains blocked pending written redistribution permission; all other unapproved sources stay disabled.

## Readiness and privacy

- `/health/live` must return 200; `/health/ready` returns 200 only when Mongo and Redis are ready.
- Verify API requests drain and worker queues close before Mongo/Redis disconnect.
- Verify Sentry `beforeSend` scrubbing. Never send request bodies, resume text, prompts, interview answers, or feedback content to logs/diagnostics.
- Confirm privacy export/account deletion covers feedback and the 180-day retention index exists.
- Confirm backup restore credentials and rehearse [backup/restore](./backup-restore.md) on an isolated copy. Review the [release checklist](./release-checklist.md) before approval.
