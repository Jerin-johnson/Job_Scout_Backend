import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
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
      { url: "http://localhost:4000", description: "Local development server" },
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
      "/api/v1/profile/upload-resume": {
        post: {
          summary: "Upload PDF/DOCX resume for structured fact parsing",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Resume encrypted and parsed with factIds" } },
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
      "/api/v1/profile/facts": {
        get: {
          summary: "List all immutable candidate facts with unique factIds",
          tags: ["Profile"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "List of facts" } },
        },
      },
      // AI Router
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
          summary: "Get precomputed top job matches with L1 cache",
          tags: ["Jobs"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "List of scored job matches" } },
        },
      },
      "/api/v1/jobs/discover": {
        post: {
          summary: "Trigger on-demand discovery pipeline",
          tags: ["Jobs"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Discovery results" } },
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
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Applications grouped by status" } },
        },
        post: {
          summary: "Track new job application",
          tags: ["Applications"],
          security: [{ bearerAuth: [] }],
          responses: { 201: { description: "Application tracked" } },
        },
      },
      "/api/v1/applications/{id}/status": {
        patch: {
          summary: "Update pipeline stage and draft automated follow-up email",
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
          summary: "Create Stripe or Razorpay checkout session",
          tags: ["Billing"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Checkout session URL" } },
        },
      },
      "/api/v1/billing/portal": {
        post: {
          summary: "Get Stripe Customer Portal session URL",
          tags: ["Billing"],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Portal session URL" } },
        },
      },
      "/api/v1/billing/stripe-webhook": {
        post: {
          summary: "Idempotent signed Stripe webhook handler",
          tags: ["Billing"],
          responses: { 200: { description: "Event processed" } },
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
  await fs.writeFile(outputPath, JSON.stringify(openApiDoc, null, 2), "utf8");
  logger.info(`OpenAPI 3.1.0 catalog successfully generated at ${outputPath}`);
}

generateOpenApi().catch((err) => {
  logger.error({ err: err.message }, "Error generating OpenAPI spec");
  process.exit(1);
});
