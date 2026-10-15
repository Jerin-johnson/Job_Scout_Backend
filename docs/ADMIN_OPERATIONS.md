# Admin operations

## Provision the first super administrator

Set `SUPER_ADMIN_EMAIL` to the email of an existing account in the backend environment, then restart the API. At startup it promotes that account to `super_admin`; if the account does not exist yet, create it normally and restart. Clear the bootstrap variable after provisioning. Never accept a role value from a public registration or profile form.

## Admin console and API

Open `/app/admin` after signing in as an `admin` or `super_admin`. The backend repeats role checks on every `/api/v1/admin` route; hiding the UI link is only a navigation convenience.

`admin` can inspect service health, accounts, jobs, and audit activity and can run job ingestion. `super_admin` additionally manages account plans and roles, views Razorpay subscriptions and payment records, and sees collected revenue summaries. Only super administrators can grant or remove administrator roles. The API prevents self-demotion and removal of the last super administrator.

- `GET /metrics`: process uptime, dependency readiness, cache statistics, router tiers, costs, and active user/job totals.
- `GET /users`: active account search by name or email. Credential fields are never returned.
- `PATCH /users/:id`: super-admin-only plan/role update. Changes to an account with an active Razorpay subscription are blocked until billing is changed in Razorpay, preventing local entitlements from contradicting recurring charges.
- `GET /billing/overview`: captured/refunded revenue by currency for the last 30 days, plan distribution, and active Razorpay subscription totals.
- `GET /billing/subscriptions`: recent persisted Razorpay subscription lifecycle records.
- `GET /billing/payments`: paginated captured/refunded payment ledger. Amounts are stored in provider currency minor units.
- `POST /billing/subscriptions/:id/cancel`: schedules active Razorpay subscription cancellation for the end of the paid period. The account keeps its entitlement until the gateway sends the lifecycle event.
- `POST /billing/payments/:paymentId/refund`: requests a refund for the remaining captured balance. It requires UI confirmation, blocks duplicate requests, and reconciles from Razorpay's refund webhook.
- `GET /jobs`: indexed job search by title/company or source.
- `GET /audit`: recent admin activity; retention follows the audit log model's one-year TTL.
- `POST /jobs/ingest`: runs enabled adapters synchronously. It has CSRF protection and an admin rate limit.

## Revenue and payment data

The payment ledger starts recording events after the Razorpay webhook is configured and this version is deployed; historical gateway payments are not backfilled. Configure the webhook signing secret and subscribe to `subscription.activated`, `subscription.authenticated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `payment.captured`, `payment.refunded`, and `refund.failed`. Unique provider payment IDs prevent duplicate capture notifications from double-counting revenue. Revenue is grouped by currency and net of recorded refunds; it does not subtract tax, gateway fees, or chargebacks.
