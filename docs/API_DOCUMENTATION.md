# JobScout API Contract & Integration Documentation

## 1. Global Network & Protocol Standards

### Base URL

- **Local Dev**: `http://localhost:4000`
- **Staging**: `https://staging-api.jobscout.ai`
- **Production**: `https://api.jobscout.ai`

### Required Request Headers

| Header             | Description                                               | Required When                                 |
| :----------------- | :-------------------------------------------------------- | :-------------------------------------------- |
| `Authorization`    | `Bearer <accessToken>`                                    | Authenticated endpoints (unless using cookie) |
| `Content-Type`     | `application/json` (or `multipart/form-data`)             | Requests containing a body                    |
| `X-Request-Id`     | Client correlation ID (echoed in response headers & logs) | Recommended on all calls                      |
| `Idempotency-Key`  | Unique token ensuring exactly-once execution              | POST mutating/billing actions                 |
| `X-Requested-With` | Value: `JobScoutClient` or `XMLHttpRequest`               | Cookie-based state-changing requests (CSRF)   |

### Unified Response Shapes

#### Standard Success

```json
{
  "data": {
    "user": {
      "id": "6724a87b1c...",
      "email": "candidate@example.com",
      "plan": "pro"
    }
  }
}
```

#### Standard Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": [
      {
        "path": "email",
        "message": "Invalid email address"
      }
    ],
    "requestId": "req_jA8lQ2fJlOqC"
  }
}
```

---

## 2. Server-Sent Events (SSE) Protocol

Streaming endpoints (like `POST /api/v1/ai/chat`) return `Content-Type: text/event-stream`.

### Event Types

1. **`event: token`**: Incremental token stream from the model.
   ```
   event: token
   data: {"text": "Based on your Kubernetes background..."}
   ```
2. **`event: progress`**: Step transition in LangGraph workflows.
   ```
   event: progress
   data: {"step": "truthfulness_check", "status": "validating_facts", "percent": 60}
   ```
3. **`event: interrupt`**: Graph paused waiting for human candidate approval.
   ```
   event: interrupt
   data: {"threadId": "th_9182x", "state": "awaiting_approval", "diff": {...}}
   ```
4. **`event: done`**: Completion signal.
   ```
   event: done
   data: {"finishReason": "stop", "latencyMs": 420, "tokensUsed": 185}
   ```

---

## 3. API Endpoint Catalog

### 3.1. Health & Readiness

- `GET /health/live`: Liveness check (HTTP 200).
- `GET /health/ready`: Readiness check verifying MongoDB & Redis connectivity (HTTP 200 or 503).

---

### 3.2. Authentication & Sessions (`/api/v1/auth`)

#### `POST /api/v1/auth/register`

Creates candidate account and sets httpOnly cookies.

- **Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "Password123!",
    "name": "Jane Doe"
  }
  ```
- **Response**: `201 Created` returning user summary & access token.

#### `POST /api/v1/auth/login`

- **Body**: `{ "email": "user@example.com", "password": "Password123!" }`
- **Response**: `200 OK` + `accessToken` & `refreshToken` cookies.
- **Lockout**: Returns `429 Too Many Requests` if locked after 5 consecutive failures.

#### `POST /api/v1/auth/google`

- **Body**: `{ "idToken": "google_jwt_credential" }`
- **Response**: `200 OK`.

#### `POST /api/v1/auth/refresh`

Rotates refresh token. Enforces reuse detection (revokes token family if reused).

#### `POST /api/v1/auth/logout`

Clears session cookies and invalidates refresh token.

#### `GET /api/v1/auth/me`

Returns active user profile, plan, and version counters.

---

### 3.3. Profile & Resume Ingestion (`/api/v1/profile`)

#### `POST /api/v1/profile/upload-resume`

- **Content-Type**: `multipart/form-data`
- **Form Fields**: `file` (PDF/DOCX, max 5MB).
- **Processing**:
  1. Validates magic bytes (not just file extension).
  2. Extracts raw text and computes SHA256 file hash.
  3. Encrypts text using AES-256-GCM and uploads to S3/R2.
  4. Invokes Small Model (Tier 1) once to extract **STRUCTURED FACTS**, assigning a unique `factId` (nanoid) to every role, skill, and achievement.
- **Response**: `200 OK` with structured profile.

#### `GET /api/v1/profile`

Retrieves candidate's structured profile and preferences.

#### `PUT /api/v1/profile/preferences`

Updates target roles, minimum salary, remote preference, and locations. Bumps profile version.

---

### 3.4. AI Router & Streaming Chat (`/api/v1/ai`)

#### `POST /api/v1/ai/chat` (SSE Streaming)

Primary candidate interaction gateway.

- **Headers**: `Accept: text/event-stream`
- **Body**:
  ```json
  {
    "prompt": "Show my applications this week",
    "threadId": "th_optional_session_id"
  }
  ```
- **Lifecycle**:
  - **Tier 0**: Checks Redis exact hash, slash commands (`/track`), and direct DB lookups. If matched, returns immediately (< 50ms).
  - **Tier 1**: Races Claude 3.5 Haiku structured classifier to determine intent and entities.
  - **Tier 2**: Escalate to LangGraph only if confidence < 0.7 or multi-step graph is needed.

#### `POST /api/v1/ai/command`

Executes instant slash commands (`/track`, `/status`, `/export`, `/stats`) at Tier 0 ($0.00 cost).

---

### 3.5. Job Discovery Pipeline (`/api/v1/jobs`)

#### `GET /api/v1/jobs/matches`

Returns precomputed top daily job matches for candidate.

- **Query Params**: `page=1&limit=10&minScore=70`
- **Response**: Array of jobs with match score, `rationale`, and `skillGaps`.

#### `POST /api/v1/jobs/:id/feedback`

Captures candidate feedback (thumbs up / down) to train long-term preferences.

- **Body**: `{ "feedback": "thumbs_up", "reason": "Loved the remote Kubernetes focus" }`

---

### 3.6. Resume Tailoring & Truthfulness (`/api/v1/tailor`)

#### `POST /api/v1/tailor/start`

Initiates LangGraph Graph B for a specific `jobId`.

- **Pre-flight**: Quota check (1 tailored doc credit).
- **Execution**: Extracts JD requirements &rarr; maps to profile `factId`s &rarr; runs `truthfulnessCheck` (regenerates if unsupported claims exist) &rarr; pauses at `interrupt()`.
- **Response**: `200 OK` with draft diff and interrupt state.

#### `POST /api/v1/tailor/:id/approve`

Resumes graph after candidate reviews and edits bullets in the UI.

- **Body**: `{ "approved": true, "customEdits": [...] }`
- **Response**: Triggers PDF/DOCX generation.

#### `GET /api/v1/tailor/:id/export?format=pdf`

Downloads compiled ATS-friendly PDF or DOCX file.

---

### 3.7. Application Tracker Kanban (`/api/v1/applications`)

#### `GET /api/v1/applications`

Retrieves candidate's Kanban board columns (`saved`, `applied`, `screening`, `interviewing`, `offer`, `rejected`). Cached in Redis for 60s.

#### `POST /api/v1/applications`

Adds a job to the tracker.

#### `PATCH /api/v1/applications/:id/status`

Updates status. Triggers Graph D to draft follow-up reminders.

#### `POST /api/v1/applications/:id/follow-up/approve`

Approves drafted follow-up email for sending via Resend. (Emails are **never** dispatched automatically).

---

### 3.8. Interview Prep & Mock Interview (`/api/v1/interview`)

#### `POST /api/v1/interview/prep`

Generates company research, role-specific question bank, and STAR stories. Requires Pro or Premium.

#### `POST /api/v1/interview/mock/turn`

Executes turn in stateful mock interview loop (hard-capped at 5 turns).

- **Body**: `{ "questionId": "q_1", "candidateAnswer": "..." }`
- **Response**: Real-time feedback, STAR score, and next question.

---

### 3.9. Long-Term Memory Control (`/api/v1/memories`)

#### `GET /api/v1/memories`

Lists candidate's stored memories (preferences, facts, goals).

#### `DELETE /api/v1/memories/:id`

Deletes an individual memory item.

#### `POST /api/v1/memories/forget-all`

Purges candidate's entire long-term memory vector collection.

---

### 3.10. Billing & Subscriptions (`/api/v1/billing`)

#### `POST /api/v1/billing/checkout`

Creates Stripe Checkout or Razorpay Subscription session.

- **Body**: `{ "plan": "pro", "provider": "stripe" }`
- **Response**: Checkout redirect URL.

#### `POST /api/v1/billing/portal`

Returns Stripe Customer Portal URL for managing cancellations and payment methods.

#### `POST /api/v1/billing/stripe-webhook`

Idempotent signed webhook endpoint for Stripe events (`customer.subscription.updated`, `invoice.payment_failed`).

#### `POST /api/v1/billing/razorpay-webhook`

Idempotent signed webhook endpoint for Razorpay events.

---

### 3.11. Admin & Telemetry (`/api/v1/admin`)

#### `GET /api/v1/admin/metrics` (Admin Role Required)

Returns operational telemetry:

- Cache hit ratio per layer (response, exact, memory, embeddings).
- AI Router tier distribution (evaluating 70–80% Tier 0/1 target).
- BullMQ queue depths and worker latencies.
- Daily LLM spend vs plan subscription revenue.

---

### 3.12. Compliance & Privacy (`/api/v1/privacy`)

#### `GET /api/v1/privacy/export`

Exports all candidate data (profile, facts, applications, memories, usage history) as JSON (GDPR / India DPDP compliance).

#### `DELETE /api/v1/privacy/delete-account`

Right-to-be-forgotten endpoint. Soft-deletes user, deletes S3 resume blobs, purges vector embeddings, and revokes tokens.
