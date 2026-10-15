# Application contacts and follow-up reminders

Applications can store a job posting URL, HR phone, company email, notes, a follow-up date, and whether a candidate reminder is enabled. Candidate reminders are delivered to the signed-in account email. The company email is saved as a contact field; the system does not email recruiters automatically.

## Runtime requirements

- MongoDB stores the application and reminder status.
- Redis and the backend worker (`npm run worker`) are required for durable, horizontally scalable delayed reminders. Run one or more worker processes; BullMQ distributes jobs safely across them.
- Resend (`RESEND_API_KEY`, `FROM_EMAIL`) is required to deliver emails. With the documented local dummy key, the worker logs a mock delivery and marks the reminder `mock`.

The API exposes reminder status on each application: `none`, `scheduled`, `processing`, `sent`, `mock`, or `failed`. A failed status means the queue or email provider could not schedule/deliver the reminder; save the reminder details again after fixing the service configuration. Queue retries use exponential backoff.

## API shape

`POST /api/v1/applications` and `PATCH /api/v1/applications/:id` accept:

```json
{
  "jobUrl": "https://jobs.example.com/role",
  "hrPhone": "+1 555 0100",
  "companyEmail": "recruiting@example.com",
  "nextFollowUpAt": "2026-10-20T15:00:00.000Z",
  "reminderEnabled": true
}
```

When `reminderEnabled` is true, a future `nextFollowUpAt` is required. Editing or disabling a reminder cancels the prior delayed job where possible; the worker also checks the current application values so stale jobs do not send. Repeated worker deliveries are guarded by an atomic application claim.

## Razorpay setup

Create monthly subscription plans in Razorpay, configure webhook events for subscription activation, charge, and cancellation, then set these backend-only variables:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_PLAN_ID_PRO`
- `RAZORPAY_PLAN_ID_PREMIUM`

The API uses the configured plan IDs to create subscriptions and returns Razorpay's hosted `short_url`. Checkout is disabled while any required credential/plan ID is a dummy value. The webhook's raw request body is verified with HMAC-SHA256 before subscription events update account entitlements. Never expose these values in frontend environment variables.
