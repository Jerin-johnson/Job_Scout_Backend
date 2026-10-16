import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as prettier from "prettier";
import { logger } from "../src/shared/utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function generateOpenApi() {
  logger.info("Generating complete openapi.json catalog...");

  const openApiDoc = {
    openapi: "3.1.0",
    info: {
      title: "JobScout Backend API",
      version: "1.0.0",
      description:
        "Production-ready backend API for JobScout, an AI-powered job-hunt agent for Discover -> Evaluate -> Prepare -> Manage workflows.",
    },
    servers: [
      { url: "http://localhost:4001", description: "Local development server" },
      { url: "https://api.jobscout.ai", description: "Production server" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    paths: {
      // Health
      "/health/live": {
        get: {
          summary: "Liveness probe",
          tags: ["Health"],
          responses: { 200: { description: "Process is live" } },
        },
      },
      "/health/ready": {
        get: {
          summary: "Readiness probe",
          tags: ["Health"],
          responses: {
            200: { description: "All dependencies reachable" },
            503: { description: "Dependencies degraded" },
          },
        },
      },
      // Auth
      "/api/v1/auth/register": {
        post: {
          summary: "Register new candidate account",
          tags: ["Authentication"],
          responses: { 201: { description: "Candidate created with tokens" } },
        },
      },
      "/api/v1/auth/login": {
        post: {
          summary: "Authenticate candidate",
          tags: ["Authentication"],
          responses: { 200: { description: "Session created" } },
        },
      },
      "/api/v1/auth/google": {
        post: {
          summary: "Google OAuth token exchange",
          tags: ["Authentication"],
          responses: { 200: { description: "Session created" } },
        },
      },
      "/api/v1/auth/refresh": {
        post: {
          summary: "Rotate refresh token with reuse detection",
          tags: ["Authentication"],
          responses: {
            200: { description: "New token pair issued" },
            401: { description: "Token reuse detected or expired" },
          },
        },
      },
      "/api/v1/auth/me": {
        get: {
          summary: "Get current candidate profile and plan",
          tags: ["Authentication"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "User session details" } },
        },
      },
      // Profile
      "/api/v1/profile/resume-upload-url": {
        post: {
          summary: "Create a short-lived user-scoped S3 resume upload URL",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Presigned S3 PUT URL and required headers" },
            400: { description: "Invalid resume file metadata" },
            503: { description: "S3 storage is unavailable or mock mode is active" },
          },
        },
      },
      "/api/v1/profile/resume-upload-complete": {
        post: {
          summary: "Verify an S3 upload and parse its resume facts",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Resume verified, encrypted, parsed, and stored" },
            400: { description: "Invalid or unsupported uploaded resume" },
            503: { description: "S3 storage or AI provider is unavailable" },
          },
        },
      },
      "/api/v1/profile/upload-resume": {
        post: {
          summary: "Upload PDF/DOCX resume for structured fact parsing",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Resume encrypted and parsed with factIds" } },
        },
      },
      "/api/v1/profile/resumes": {
        get: {
          summary: "List the authenticated user's resume metadata without document contents",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Owned resume metadata" } },
        },
      },
      "/api/v1/profile/preferences": {
        put: {
          summary: "Update target role, salary, and location preferences",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Preferences updated and version bumped" } },
        },
      },
      "/api/v1/profile/preferences/target-roles": {
        patch: {
          summary: "Confirm target roles suggested from a typo correction or resume facts",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["targetRoles"], properties: { targetRoles: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 120 } } }, additionalProperties: false } } },
          },
          responses: { 200: { description: "Confirmed target roles saved; all other preferences preserved" } },
        },
      },
      "/api/v1/profile/facts": {
        get: {
          summary: "List all immutable candidate facts with unique factIds",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "List of facts" } },
        },
      },
      // AI Router
      "/api/v1/ai/models": {
        get: {
          summary: "List configured free-tier chat models",
          tags: ["AI Router"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Configured models allowed for user chat" } },
        },
      },
      "/api/v1/ai/route": {
        post: {
          summary: "Classify and route candidate prompt across 3 tiers",
          tags: ["AI Router"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Routing decision & execution output" } },
        },
      },
      "/api/v1/ai/chat": {
        post: {
          summary: "SSE streaming AI conversational endpoint",
          description:
            "Required modelId is checked against the server-side selectable free-tier model allowlist.",
          tags: ["AI Router"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Text event stream with routing & token events" } },
        },
      },
      // Memories
      "/api/v1/memories": {
        get: {
          summary: "List candidate long-term memories",
          tags: ["Memories"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Candidate memories" } },
        },
      },
      "/api/v1/memories/toggle-pause": {
        post: {
          summary: "Pause or unpause agent memory writes",
          tags: ["Memories"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Memory status toggled" } },
        },
      },
      "/api/v1/memories/forget-all": {
        post: {
          summary: "Purge candidate vector memory collection",
          tags: ["Memories"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Memories cleared" } },
        },
      },
      // Jobs & Discovery
      "/api/v1/jobs/matches": {
        get: {
          summary: "Get precomputed profile recommendations and refresh state",
          tags: ["Jobs"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "List of scored job matches" } },
        },
      },
      "/api/v1/jobs/matches/refresh": {
        get: {
          summary: "Get the signed-in user's match refresh state",
          tags: ["Jobs"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Queued, running, completed, or failed refresh state" } },
        },
      },
      "/api/v1/jobs/catalog": {
        get: {
          summary: "Search the paginated catalog of indexed jobs",
          description: "Search only active jobs indexed from approved, enabled sources; this catalog is not the whole internet. Results include source and posted date.",
          tags: ["Jobs"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "location", in: "query", schema: { type: "string" } },
            { name: "countryCode", in: "query", schema: { type: "string", pattern: "^[A-Za-z]{2}$" } },
            { name: "source", in: "query", schema: { type: "string" } },
            {
              name: "remoteType",
              in: "query",
              schema: { type: "string", enum: ["remote", "hybrid", "onsite"] },
            },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
          ],
          responses: { 200: { description: "Filtered indexed jobs and pagination metadata" } },
        },
      },
      "/api/v1/jobs/discover": {
        post: {
          summary: "Queue a coalesced asynchronous match refresh",
          tags: ["Jobs"],
          security: [{ bearerAuth: [] }],
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { broaden: { type: "boolean", description: "Temporarily relax work mode, country, occupation, and salary filters for this refresh" } }, additionalProperties: false } } } },
          responses: { 202: { description: "Refresh queued; poll /matches/refresh" } },
        },
      },
      "/api/v1/jobs/{id}/feedback": {
        post: {
          summary: "Record match feedback (thumbs up / down) and update preferences",
          tags: ["Jobs"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Feedback recorded" } },
        },
      },
      // Resume Tailoring (Graph B)
      "/api/v1/tailor/start": {
        post: {
          summary: "Start truthful resume tailoring for a target role",
          tags: ["Tailoring"],
          security: [{ bearerAuth: [] }],
          responses: { 201: { description: "Draft created awaiting candidate approval" } },
        },
      },
      "/api/v1/tailor/{id}/approve": {
        post: {
          summary: "Approve draft and compile ATS-friendly PDF/DOCX",
          tags: ["Tailoring"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Exports generated with storage URLs" } },
        },
      },
      "/api/v1/tailor/{id}/export": {
        get: {
          summary: "Download compiled resume binary (format=pdf or docx)",
          tags: ["Tailoring"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Binary file stream" } },
        },
      },
      // Applications Kanban (Graph D)
      "/api/v1/applications": {
        get: {
          summary: "Get Kanban board columns of tracked applications",
          description:
            "Returns the existing grouped columns and flat applications list. Archived cards are excluded. Supports server-side search, stage, priority, pin, follow-up, stale, and sort filters. Includes unfiltered board statistics.",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "q",
              schema: { type: "string", maxLength: 100 },
              description: "Search company and role",
            },
            {
              in: "query",
              name: "stage",
              schema: { type: "string" },
              description: "Comma-separated pipeline stages",
            },
            {
              in: "query",
              name: "priority",
              schema: { type: "string", enum: ["high", "medium", "low"] },
            },
            { in: "query", name: "pinned", schema: { type: "boolean" } },
            {
              in: "query",
              name: "followUp",
              schema: { type: "string", enum: ["overdue", "due-soon"] },
            },
            { in: "query", name: "stale", schema: { type: "boolean" } },
            { in: "query", name: "appliedSinceDays", schema: { type: "integer", enum: [7] } },
            {
              in: "query",
              name: "sort",
              schema: { type: "string", enum: ["recommended", "recent", "follow-up", "priority"] },
            },
          ],
          responses: {
            200: {
              description:
                "Applications grouped by status; the client board orders cards by pinned state, priority, follow-up date, then activity",
            },
          },
        },
        post: {
          summary: "Track new job application",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["company", "role"],
                  properties: {
                    company: { type: "string" },
                    role: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["saved", "applied", "screening", "interviewing", "offer", "rejected"],
                    },
                    priority: {
                      type: "string",
                      enum: ["high", "medium", "low"],
                      default: "medium",
                    },
                    pinnedAt: { type: ["string", "null"], format: "date-time" },
                    source: { type: "string" },
                    location: { type: "string", maxLength: 160 },
                    salaryMin: { type: ["number", "null"], minimum: 0 },
                    salaryMax: { type: ["number", "null"], minimum: 0 },
                    nextFollowUpAt: { type: ["string", "null"], format: "date-time" },
                    reminderEnabled: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Application tracked" } },
        },
      },
      "/api/v1/applications/{id}": {
        get: {
          summary: "Get a tracked application and its details",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Application details" } },
        },
        patch: {
          summary: "Update application contacts, job link, notes, and reminder",
          description:
            "Supports priority (high/medium/low), pinnedAt (null to unpin), source, job details, and reminders additively. A card's stage color is derived from status and is never stored. Ownership mismatches return 404.",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    priority: { type: "string", enum: ["high", "medium", "low"] },
                    pinnedAt: { type: ["string", "null"], format: "date-time" },
                    source: { type: "string" },
                    location: { type: "string", maxLength: 160 },
                    salaryMin: { type: ["number", "null"], minimum: 0 },
                    salaryMax: { type: ["number", "null"], minimum: 0 },
                    nextFollowUpAt: { type: ["string", "null"], format: "date-time" },
                    reminderEnabled: { type: "boolean" },
                    notes: { type: "string", maxLength: 5000 },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Application details updated" } },
        },
        delete: {
          summary: "Permanently delete an owned application",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Application deleted" },
            404: { description: "Application not found" },
          },
        },
      },
      "/api/v1/applications/{id}/archive": {
        patch: {
          summary: "Archive or restore an owned application",
          description:
            "Archiving hides the application from the active board and cancels its reminder. Optional archive reason: withdrawn, ghosted, or no_longer_interested.",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    archived: { type: "boolean", default: true },
                    reason: {
                      type: "string",
                      enum: ["withdrawn", "ghosted", "no_longer_interested"],
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Application archived or restored" },
            404: { description: "Application not found" },
          },
        },
      },
      "/api/v1/applications/{id}/status": {
        patch: {
          summary: "Update pipeline stage and draft automated follow-up email",
          description:
            "Moves a card between the six fixed stages and updates its activity timestamp. Offer and Rejected cancel active follow-up reminders.",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Stage updated and draft created" } },
        },
      },
      "/api/v1/applications/{id}/follow-up/approve": {
        post: {
          summary: "Human-in-the-loop approval to send follow-up email",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Follow-up email dispatched" } },
        },
      },
      // Interview Prep & Mock (Graph C)
      "/api/v1/interview/modes": {
        get: {
          summary: "List interview modes and current consent version",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Interview setup configuration" } },
        },
      },
      "/api/v1/interview/sessions": {
        get: {
          summary: "List the authenticated user's mock interview sessions",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Paginated session history" } },
        },
        post: {
          summary: "Create a durable mock interview session with recorded consent",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: {
            201: { description: "Interview session created" },
            403: { description: "Plan does not include mock interviews" },
            429: { description: "Daily quota reached" },
          },
        },
      },
      "/api/v1/interview/sessions/{id}": {
        get: {
          summary: "Get an owned session and its transcript",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Session details" },
            404: { description: "Session not found" },
          },
        },
        delete: {
          summary: "Delete an owned session, transcript, and report",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Session deleted" } },
        },
      },
      "/api/v1/interview/sessions/{id}/start": {
        post: {
          summary: "Start an interview and begin server-enforced duration",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "First question and timed session" },
            409: { description: "Invalid session state" },
          },
        },
      },
      "/api/v1/interview/sessions/{id}/answers": {
        post: {
          summary: "Submit an idempotent text answer and get validated feedback",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 8, maxLength: 128 },
            },
          ],
          responses: {
            200: { description: "Evaluation and next question" },
            409: { description: "Answer already in progress or session state conflict" },
            410: { description: "Session time elapsed" },
            429: { description: "Per-session token cap reached" },
          },
        },
      },
      "/api/v1/interview/sessions/{id}/answers/stream": {
        post: {
          summary: "Submit an idempotent answer and stream the next question using SSE",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 8, maxLength: 128 },
            },
          ],
          responses: {
            200: {
              description: "Server-sent token events followed by the complete answer result",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            409: { description: "Answer processing or session state conflict" },
            429: { description: "Rate or token limit reached" },
          },
        },
      },
      "/api/v1/interview/sessions/{id}/complete": {
        post: {
          summary: "Create or return the session's single validated report",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Idempotent report" },
            409: { description: "No answers or invalid state" },
          },
        },
      },
      "/api/v1/interview/sessions/{id}/report": {
        get: {
          summary: "Get a saved report for an owned session",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Validated interview report" },
            404: { description: "Report not found" },
          },
        },
      },
      "/api/v1/interview/prep": {
        post: {
          summary: "Generate role question bank, company brief, and STAR stories",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Interview preparation package" } },
        },
      },
      "/api/v1/interview/mock/turn": {
        post: {
          summary: "Submit mock interview answer for STAR evaluation (capped at 5 turns)",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Turn score, feedback, and next question" } },
        },
      },
      "/api/v1/interview/{id}/report": {
        get: {
          summary: "Get comprehensive performance scorecard across mock turns",
          tags: ["Interview"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Scorecard report" } },
        },
      },
      // Billing & Subscriptions
      "/api/v1/billing/checkout": {
        post: {
          summary: "Create Razorpay subscription checkout session",
          tags: ["Billing"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Checkout session URL" } },
        },
      },
      "/api/v1/billing/razorpay-webhook": {
        post: {
          summary: "Idempotent signed Razorpay webhook handler",
          tags: ["Billing"],
          responses: { 200: { description: "Event processed" } },
        },
      },
      // Admin
      "/api/v1/admin/metrics": {
        get: {
          summary: "Operational telemetry, tier ratios, and cost audit (Admin only)",
          tags: ["Admin"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Telemetry metrics payload" },
            403: { description: "Forbidden - Admin role required" },
          },
        },
      },
      "/api/v1/admin/users": {
        get: {
          summary: "Search active accounts (admin only)",
          tags: ["Admin"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            200: { description: "Paginated account directory" },
            403: { description: "Admin role required" },
            503: { description: "MongoDB unavailable" },
          },
        },
      },
      "/api/v1/admin/users/{id}": {
        patch: {
          summary: "Set account plan or access role (super administrator only)",
          tags: ["Admin"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Account updated" },
            403: { description: "Super administrator role required" },
            409: { description: "Change conflicts with account protection or active billing" },
          },
        },
      },
      "/api/v1/admin/billing/overview": {
        get: {
          summary:
            "Revenue, payments, plans, and active subscription summary (super administrator only)",
          tags: ["Admin Billing"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Razorpay billing overview" },
            403: { description: "Super administrator role required" },
          },
        },
      },
      "/api/v1/admin/billing/subscriptions": {
        get: {
          summary: "List recorded subscription lifecycle data (super administrator only)",
          tags: ["Admin Billing"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Subscription records" },
            403: { description: "Super administrator role required" },
          },
        },
      },
      "/api/v1/admin/billing/subscriptions/{id}/cancel": {
        post: {
          summary:
            "Schedule an active Razorpay subscription to cancel at period end (super administrator only)",
          tags: ["Admin Billing"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Cancellation scheduled" },
            403: { description: "Super administrator role required" },
            409: { description: "Subscription is not cancellable" },
          },
        },
      },
      "/api/v1/admin/billing/payments": {
        get: {
          summary: "List captured and refunded payments (super administrator only)",
          tags: ["Admin Billing"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Paginated payment records" },
            403: { description: "Super administrator role required" },
          },
        },
      },
      "/api/v1/admin/billing/payments/{paymentId}/refund": {
        post: {
          summary: "Request refund of the remaining payment balance (super administrator only)",
          tags: ["Admin Billing"],
          security: [{ bearerAuth: [] }],
          responses: {
            202: { description: "Refund submitted to Razorpay" },
            403: { description: "Super administrator role required" },
            409: { description: "Payment cannot be refunded" },
          },
        },
      },
      "/api/v1/admin/jobs": {
        get: {
          summary: "Search indexed job inventory (admin only)",
          tags: ["Admin"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "source", in: "query", schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            200: { description: "Paginated job inventory" },
            403: { description: "Admin role required" },
          },
        },
      },
      "/api/v1/admin/jobs/sources": {
        get: {
          summary: "List job source policies, budgets, and ingestion health (admin only)",
          tags: ["Admin"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Source approval state, daily quota use, metrics, and health" },
            403: { description: "Admin role required" },
          },
        },
      },
      "/api/v1/admin/jobs/sources/{key}": {
        patch: {
          summary: "Enable or disable an already approved source (admin only)",
          tags: ["Admin"],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } } } } },
          responses: {
            200: { description: "Updated source switch and current source budgets" },
            403: { description: "Admin role required" },
            404: { description: "Source is unknown or has not passed the policy gate" },
          },
        },
      },
      "/api/v1/admin/audit": {
        get: {
          summary: "List recent admin audit events (admin only)",
          tags: ["Admin"],
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "page", in: "query", schema: { type: "integer" } }],
          responses: {
            200: { description: "Paginated admin audit history" },
            403: { description: "Admin role required" },
            503: { description: "MongoDB unavailable" },
          },
        },
      },
      // Privacy & GDPR
      "/api/v1/privacy/export": {
        get: {
          summary: "GDPR/DPDP JSON export of all candidate data",
          tags: ["Privacy"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Export bundle" } },
        },
      },
      "/api/v1/privacy/delete-account": {
        delete: {
          summary: "Right-to-be-forgotten permanent account and memory deletion",
          tags: ["Privacy"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Account and memories deleted" } },
        },
      },
    },
  };

  const outputPath = path.resolve(__dirname, "../openapi.json");
  const prettierOptions = (await prettier.resolveConfig(outputPath)) || {};
  const formatted = await prettier.format(JSON.stringify(openApiDoc), {
    ...prettierOptions,
    filepath: outputPath,
  });
  await fs.writeFile(outputPath, formatted, "utf8");
  logger.info(`OpenAPI 3.1.0 catalog successfully generated at ${outputPath}`);
}

generateOpenApi().catch((err) => {
  logger.error({ err: err.message }, "Error generating OpenAPI spec");
  process.exit(1);
});
