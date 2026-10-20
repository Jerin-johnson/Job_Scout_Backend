# JobScout API Contracts & Specification

This document provides the canonical API contracts for all endpoints implemented in `jobscout-api`. All migrated TypeScript presentation controllers and DTOs must adhere strictly to these schemas, parameter names, and response models.

## 1. Global Conventions

### Base URL & Versioning

- Local Development: `http://localhost:4001`
- Production: `https://api.jobscout.ai`
- API Version Prefix: `/api/v1`

### Authentication & Headers

- **Bearer Token:** `Authorization: Bearer <accessToken>`
- **HTTP-Only Cookies:** `accessToken` (15m TTL), `refreshToken` (7d TTL, path `/api/v1/auth/refresh`)
- **Correlation ID:** `X-Request-Id` (propagated in request and returned on all responses)
- **CORS:** Strict origin allowlist matching trusted frontend origins.

### Common Response Model

#### Standard Success Envelope

```json
{
  "data": { ... }
}
```

#### Standard Error Envelope

```json
{
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human readable error description",
    "details": [
      {
        "path": "fieldName",
        "message": "Validation rule explanation"
      }
    ],
    "requestId": "req_123456789"
  }
}
```

---

## 2. Endpoints by Domain

### 2.1 Health & Diagnostics

- `GET /health` -> `200 OK`: `{ status: "ok", timestamp: string }`
- `GET /health/live` -> `200 OK`: `{ status: "live", uptime: number }`
- `GET /health/ready` -> `200 OK` (or `503 Service Unavailable`): `{ status: "ready", mongo: boolean, redis: boolean, timestamp: string }`

### 2.2 Authentication (`/api/v1/auth`)

- **`POST /register`**
  - **Body DTO:** `{ email: string (email), password: string (min 8), name?: string }`
  - **Response `201 Created`:** `{ data: { user: UserDTO, accessToken: string } }`
  - **Cookies:** Sets `accessToken`, `refreshToken`.
- **`POST /login`**
  - **Body DTO:** `{ email: string (email), password: string }`
  - **Response `200 OK`:** `{ data: { user: UserDTO, accessToken: string } }`
  - **Error `401 Unauthorized`:** `INVALID_CREDENTIALS`
  - **Error `429 Too Many Requests`:** `ACCOUNT_LOCKED`
- **`POST /google`**
  - **Body DTO:** `{ idToken: string }`
  - **Response `200 OK`:** `{ data: { user: UserDTO, accessToken: string } }`
- **`POST /refresh`**
  - **Body/Cookie DTO:** `refreshToken` from cookie or body
  - **Response `200 OK`:** `{ data: { accessToken: string } }`
  - **Error `401 Unauthorized`:** `TOKEN_REUSE_DETECTED` (revokes entire token family)
- **`POST /logout`**
  - **Auth:** Optional / Bearer
  - **Response `200 OK`:** `{ data: { message: "Logged out successfully" } }`
  - **Cookies:** Clears auth cookies.
- **`GET /me`**
  - **Auth:** Bearer / Cookie required
  - **Response `200 OK`:** `{ data: { user: UserDTO } }`

### 2.3 Candidate Profile & Resumes (`/api/v1/profile`)

- **`GET /`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { profile: ProfileDTO, completion: number, missingFields: string[] } }`
- **`PUT /`**
  - **Auth:** Required
  - **Body DTO:** `{ skills?: string[], roles?: RoleDTO[], education?: EducationDTO[], preferences?: PreferencesDTO }`
  - **Response `200 OK`:** `{ data: { profile: ProfileDTO } }`
- **`POST /resumes/presign`**
  - **Auth:** Required
  - **Body DTO:** `{ filename: string, contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileSize: number }`
  - **Response `200 OK`:** `{ data: { uploadUrl: string, key: string, resumeId: string } }`
- **`POST /resumes/complete`**
  - **Auth:** Required
  - **Body DTO:** `{ resumeId: string, key: string, filename: string }`
  - **Response `200 OK`:** `{ data: { resume: ResumeDTO, profile: ProfileDTO, extractedFacts: ExtractedFactsDTO } }`
- **`GET /resumes`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { resumes: ResumeDTO[] } }`
- **`DELETE /resumes/:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { success: true } }`
- **`POST /resumes/:id/reread`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { extractedFacts: ExtractedFactsDTO, updatedProfile: ProfileDTO } }`
- **`GET /suggestions`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { roleSuggestions: string[], skillSuggestions: string[] } }`
- **`PATCH /career-profile`**
  - **Auth:** Required
  - **Body DTO:** `{ targetRoles?: TargetRoleDTO[], experience?: ExperienceDTO, homeLocation?: LocationDTO, targetLocations?: LocationDTO[], workPreferences?: WorkPreferencesDTO, compensation?: CompensationDTO }`
  - **Response `200 OK`:** `{ data: { careerProfile: CareerProfileDTO } }`
- **`PATCH /ai-consent`**
  - **Auth:** Required
  - **Body DTO:** `{ aiConsent: boolean, memoryConsent?: boolean }`
  - **Response `200 OK`:** `{ data: { consentUpdated: boolean } }`

### 2.4 Jobs & Catalog Discovery (`/api/v1/jobs`)

- **`GET /search`**
  - **Query DTO:** `q?: string, location?: string, remoteType?: "remote" | "hybrid" | "onsite", page?: number, limit?: number, sort?: "recommended" | "recent" | "salary"`
  - **Response `200 OK`:** `{ data: { jobs: JobCardDTO[], total: number, page: number, totalPages: number, catalogVersion: number } }`
- **`GET /recommended`**
  - **Auth:** Required
  - **Query DTO:** `limit?: number, cursor?: string`
  - **Response `200 OK`:** `{ data: { jobs: ScoredJobDTO[], cursor?: string, total: number } }`
- **`GET /saved-searches`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { savedSearches: SavedSearchDTO[] } }`
- **`POST /saved-searches`**
  - **Auth:** Required
  - **Body DTO:** `{ name: string, filters: SearchFiltersDTO, alertFrequency: "daily" | "instant" | "none" }`
  - **Response `201 Created`:** `{ data: { savedSearch: SavedSearchDTO } }`
- **`DELETE /saved-searches/:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { success: true } }`
- **`POST /saved-searches/:id/alerts`**
  - **Auth:** Required
  - **Body DTO:** `{ enabled: boolean, frequency: "daily" | "instant" }`
  - **Response `200 OK`:** `{ data: { savedSearch: SavedSearchDTO } }`
- **`GET /saved-searches/:id/preview`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { previewCount: number, sampleJobs: JobCardDTO[] } }`
- **`GET /saved`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { savedJobs: JobCardDTO[] } }`
- **`POST /save`**
  - **Auth:** Required
  - **Body DTO:** `{ jobId: string }`
  - **Response `200 OK`:** `{ data: { saved: boolean } }`
- **`POST /hide`**
  - **Auth:** Required
  - **Body DTO:** `{ jobId: string }`
  - **Response `200 OK`:** `{ data: { hidden: boolean } }`
- **`GET /:id`**
  - **Response `200 OK`:** `{ data: { job: JobDetailDTO, match?: MatchBreakdownDTO } }`

### 2.5 Application Tracker (`/api/v1/applications`)

- **`GET /`**
  - **Auth:** Required
  - **Query DTO:** `stage?: string, priority?: string, search?: string, followUp?: "overdue" | "due-soon", sort?: string`
  - **Response `200 OK`:** `{ data: { applications: ApplicationDTO[], stats: KanbanStatsDTO, fromCache?: boolean } }`
- **`POST /`**
  - **Auth:** Required
  - **Body DTO:** `{ jobId?: string, company: string, role: string, status?: string, priority?: string, location?: string, salaryMin?: number, salaryMax?: number, notes?: string, jobUrl?: string }`
  - **Response `201 Created`:** `{ data: { application: ApplicationDTO } }`
- **`GET /stats`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { stats: KanbanStatsDTO } }`
- **`GET /:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { application: ApplicationDetailDTO } }`
- **`PUT /:id`**
  - **Auth:** Required
  - **Body DTO:** `{ priority?: string, location?: string, salaryMin?: number, salaryMax?: number, notes?: string, jobUrl?: string, nextFollowUpAt?: string, reminderEnabled?: boolean }`
  - **Response `200 OK`:** `{ data: { application: ApplicationDTO } }`
- **`PATCH /:id/status`**
  - **Auth:** Required
  - **Body DTO:** `{ status: "saved" | "applied" | "screening" | "interviewing" | "offer" | "rejected", note?: string }`
  - **Response `200 OK`:** `{ data: { application: ApplicationDTO } }`
- **`PATCH /:id/archive`**
  - **Auth:** Required
  - **Body DTO:** `{ archived: boolean, reason?: string }`
  - **Response `200 OK`:** `{ data: { application: ApplicationDTO } }`
- **`DELETE /:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { success: true } }`
- **`POST /:id/timeline`**
  - **Auth:** Required
  - **Body DTO:** `{ stage: string, note?: string, timestamp?: string }`
  - **Response `200 OK`:** `{ data: { application: ApplicationDTO } }`
- **`POST /:id/follow-up`**
  - **Auth:** Required
  - **Body DTO:** `{ nextFollowUpAt: string, reminderEnabled: boolean }`
  - **Response `200 OK`:** `{ data: { application: ApplicationDTO } }`

### 2.6 Mock Interview Prep (`/api/v1/interview`)

- **`POST /sessions`**
  - **Auth:** Required
  - **Body DTO:** `{ role: string, level: "fresher" | "mid" | "senior", mode: "behavioral" | "technical" | "hr" | "aptitude_case" | "founder", durationMinutes: 15 | 30, resumeId?: string, jobId?: string, jobDescription?: string }`
  - **Response `201 Created`:** `{ data: { session: InterviewSessionDTO } }`
- **`GET /sessions/:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { session: InterviewSessionDetailDTO } }`
- **`POST /sessions/:id/messages`**
  - **Auth:** Required
  - **Body DTO:** `{ message: string }`
  - **Response `200 OK`:** `{ data: { reply: string, turnNumber: number, isFinished: boolean } }`
- **`POST /sessions/:id/finish`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { session: InterviewSessionDTO, report: InterviewReportDTO } }`
- **`GET /sessions/:id/report`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { report: InterviewReportDTO } }`
- **`GET /reports`**
  - **Auth:** Required
  - **Query DTO:** `limit?: number`
  - **Response `200 OK`:** `{ data: { reports: InterviewReportSummaryDTO[] } }`

### 2.7 AI Chat Assistant (`/api/v1/ai`)

- **`POST /chat`**
  - **Auth:** Required
  - **Body DTO:** `{ message: string, threadId?: string, pageContext?: { page: string, jobId?: string, applicationId?: string } }`
  - **Response `200 OK` (SSE Stream):**
    - `event: routing` -> `{ agent: string }`
    - `event: tool_status` -> `{ toolName: string, status: "executing" | "complete" }`
    - `event: token` -> `{ text: string }`
    - `event: sources` -> `{ sources: string[] }`
    - `event: action` -> `{ actionId: string, title: string, token: string }`
    - `event: done` -> `{ threadId: string, usage: UsageDTO }`
- **`GET /sessions`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { sessions: ChatSessionDTO[] } }`
- **`PATCH /sessions/:id`**
  - **Auth:** Required
  - **Body DTO:** `{ title: string }`
  - **Response `200 OK`:** `{ data: { session: ChatSessionDTO } }`
- **`DELETE /sessions/:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { success: true } }`
- **`POST /actions/confirm`**
  - **Auth:** Required
  - **Header:** `Idempotency-Key: string` (min 8 chars)
  - **Body DTO:** `{ token: string }`
  - **Response `200 OK`:** `{ data: { status: "confirmed", actionType: string, result: ActionExecutionResultDTO } }`
- **`GET /actions/audit`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { auditLogs: AuditLogDTO[] } }`

### 2.8 Candidate Memory (`/api/v1/memories`)

- **`GET /`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { memories: MemoryDTO[], consentGranted: boolean, memoriesPaused: boolean } }`
- **`PATCH /:id`**
  - **Auth:** Required
  - **Body DTO:** `{ content: string }`
  - **Response `200 OK`:** `{ data: { memory: MemoryDTO } }`
- **`DELETE /:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { success: true } }`
- **`DELETE /`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { success: true, count: number } }`
- **`POST /toggle-pause`**
  - **Auth:** Required
  - **Body DTO:** `{ paused: boolean }`
  - **Response `200 OK`:** `{ data: { memoriesPaused: boolean } }`
- **`POST /consent`**
  - **Auth:** Required
  - **Body DTO:** `{ consentGranted: boolean }`
  - **Response `200 OK`:** `{ data: { consentGranted: boolean, consentVersion: string } }`

### 2.9 Resume Match (`/api/v1/resume-match`)

- **`POST /score`**
  - **Auth:** Required
  - **Body DTO:** `{ resumeId?: string, jobId?: string, applicationId?: string, jobText?: string }`
  - **Response `200 OK`:** `{ data: { report: MatchReportDTO } }`
- **`GET /reports`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { reports: MatchReportSummaryDTO[] } }`
- **`GET /reports/:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { report: MatchReportDTO } }`
- **`DELETE /reports/:id`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { success: true } }`
- **`POST /ignore-keyword`**
  - **Auth:** Required
  - **Body DTO:** `{ reportId: string, keyword: string }`
  - **Response `200 OK`:** `{ data: { report: MatchReportDTO } }`
- **`POST /suggestions`**
  - **Auth:** Required
  - **Body DTO:** `{ reportId: string }`
  - **Response `200 OK`:** `{ data: { suggestions: SuggestionDTO[] } }`

### 2.10 Resume Tailoring (`/api/v1/tailor`)

- **`POST /tailor`**
  - **Auth:** Required
  - **Body DTO:** `{ resumeId: string, jobId?: string, jobDescription?: string, tone?: "professional" | "concise" | "technical" }`
  - **Response `200 OK`:** `{ data: { tailoredDocId: string, diff: TailorDiffDTO } }`
- **`POST /diff`**
  - **Auth:** Required
  - **Body DTO:** `{ tailoredDocId: string }`
  - **Response `200 OK`:** `{ data: { diff: TailorDiffDTO } }`
- **`POST /download`**
  - **Auth:** Required
  - **Body DTO:** `{ tailoredDocId: string, format: "pdf" | "docx" }`
  - **Response `200 OK`:** File stream (`Content-Type: application/pdf` or docx).

### 2.11 Billing & Subscriptions (`/api/v1/billing`)

- **`POST /create-order`**
  - **Auth:** Required
  - **Body DTO:** `{ plan: "starter" | "pro" | "annual", currency?: "INR" | "USD" }`
  - **Response `200 OK`:** `{ data: { orderId: string, amount: number, currency: string, keyId: string } }`
- **`POST /verify-payment`**
  - **Auth:** Required
  - **Body DTO:** `{ razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string }`
  - **Response `200 OK`:** `{ data: { success: true, subscription: SubscriptionDTO } }`
- **`POST /razorpay-webhook`**
  - **Header:** `X-Razorpay-Signature: string`
  - **Raw Body:** JSON event string
  - **Response `200 OK`:** `{ status: "received" }`
- **`GET /subscription`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { subscription: SubscriptionDTO, plan: PlanDetailsDTO } }`
- **`POST /cancel-subscription`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { canceled: boolean } }`

### 2.12 Admin & Coverage Telemetry (`/api/v1/admin`)

- **`GET /sources`**
  - **Auth:** Required (Role: `admin`)
  - **Response `200 OK`:** `{ data: { sources: JobSourceDTO[] } }`
- **`POST /sources/:name/toggle`**
  - **Auth:** Required (Role: `admin`)
  - **Body DTO:** `{ enabled: boolean }`
  - **Response `200 OK`:** `{ data: { source: JobSourceDTO } }`
- **`GET /sources/stats`**
  - **Auth:** Required (Role: `admin`)
  - **Response `200 OK`:** `{ data: { stats: FeedStatsDTO } }`
- **`GET /coverage`**
  - **Auth:** Required (Role: `admin`)
  - **Response `200 OK`:** `{ data: { coverage: CoverageReportDTO } }`

### 2.13 Privacy & Data Rights (`/api/v1/privacy`)

- **`GET /export`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { exportArchive: CompleteUserDataExportDTO } }`
- **`POST /delete-account`**
  - **Auth:** Required
  - **Body DTO:** `{ confirmation: "DELETE_MY_ACCOUNT" }`
  - **Response `200 OK`:** `{ data: { deleted: true, message: "Account and all associated records permanently purged." } }`
- **`GET /consents`**
  - **Auth:** Required
  - **Response `200 OK`:** `{ data: { consents: UserConsentRecordsDTO } }`
- **`POST /consents`**
  - **Auth:** Required
  - **Body DTO:** `{ consentKey: string, granted: boolean }`
  - **Response `200 OK`:** `{ data: { updated: boolean } }`

### 2.14 User Feedback (`/api/v1/feedback`)

- **`POST /`**
  - **Auth:** Required
  - **Body DTO:** `{ feature: string, rating: number (1-5), comment?: string, metadata?: Record<string, unknown> }`
  - **Response `201 Created`:** `{ data: { feedbackId: string } }`
