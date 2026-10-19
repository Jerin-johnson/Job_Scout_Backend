import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { env } from "../../config/env.js";
import { isMongoReady } from "../../config/database.js";
import { getCandidateContext, invalidateCandidateContext } from "../candidateContext.js";
import { profileRepository } from "../../repositories/profileRepository.js";
import { applicationRepository } from "../../repositories/applicationRepository.js";
import { applicationReminderTransition } from "../../services/applicationLifecycle.js";
import {
  scheduleApplicationReminder,
  cancelApplicationReminder,
} from "../../services/applicationReminderQueue.js";
import { jobIngestionService } from "../../services/jobs/jobIngestionService.js";
import { scoreJobMatch } from "../../services/jobs/matching.js";
import { classifyEligibility, profileApplicantCountries } from "../../services/jobs/eligibility.js";
import { getJobRiskFlags } from "../../services/jobs/jobRisk.js";
import {
  scoreResumeForJob,
  reportJobHash,
  RESUME_MATCH_SCORE_VERSION,
} from "../../services/resumeMatchService.js";
import { interviewSessionService } from "../../services/interview/sessionService.js";
import { longTermMemory } from "../memory/longTerm.js";
import { Job } from "../../models/Job.js";
import { JobDetail } from "../../models/JobDetail.js";
import { HiddenJob } from "../../models/HiddenJob.js";
import { JobMatchReport } from "../../models/JobMatchReport.js";
import { InterviewSession } from "../../models/InterviewSession.js";
import { InterviewReport } from "../../models/InterviewReport.js";
import { AuditLog } from "../../models/AuditLog.js";
import { CacheKeys, del } from "../../shared/cache.js";
import { logger } from "../../shared/utils/logger.js";

export const ACTION_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const inMemoryConsumedActions = new Map();
const inMemoryAuditLogs = [];

export const TOOL_STATUS_LABELS = Object.freeze({
  get_profile_summary: "Checking your profile summary...",
  get_career_profile_status: "Checking your career profile completeness...",
  search_jobs: "Searching matching jobs...",
  get_job: "Reading job details...",
  run_resume_match: "Running deterministic resume match...",
  list_applications: "Checking your applications...",
  get_application: "Reading application details...",
  get_interview_reports: "Checking your mock interview reports...",
  get_interview_report: "Reading interview report details...",
  get_resume_facts: "Checking your resume facts...",
  search_memories: "Checking your saved preferences...",
  propose_add_job_to_tracker: "Preparing job tracker confirmation card...",
  propose_set_follow_up: "Preparing follow-up reminder card...",
  propose_set_application_priority: "Preparing priority update card...",
  propose_start_practice_interview: "Preparing mock interview launch card...",
  propose_open_resume_match: "Preparing resume match workspace card...",
});

export const TOOL_SOURCE_LABELS = Object.freeze({
  get_profile_summary: "Profile",
  get_career_profile_status: "Career Profile",
  search_jobs: "Jobs",
  get_job: "Jobs",
  run_resume_match: "Resume Match",
  list_applications: "Applications",
  get_application: "Applications",
  get_interview_reports: "Interviews",
  get_interview_report: "Interviews",
  get_resume_facts: "Resume",
  search_memories: "Memories",
  propose_add_job_to_tracker: "Applications",
  propose_set_follow_up: "Applications",
  propose_set_application_priority: "Applications",
  propose_start_practice_interview: "Interviews",
  propose_open_resume_match: "Resume Match",
});

function sanitizeString(value, maxChars = 600) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function sanitizeDeep(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value, 800);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDeep(item, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "encryptedRawText" || k === "embedding" || k === "password") continue;
      out[k] = sanitizeDeep(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Wraps any tool output in an explicit untrusted delimiter block so prompt-injection
 * instructions inside job descriptions, application notes, or resume text are treated strictly as data.
 */
export function wrapUntrustedToolResult(toolName, payload, maxChars = 2800) {
  const safeName = String(toolName || "tool").replace(/[^a-z0-9_]/gi, "_");
  const sanitized = sanitizeDeep(payload);
  const serialized = JSON.stringify(sanitized);
  const body =
    serialized.length > maxChars ? `${serialized.slice(0, maxChars)}...[truncated]` : serialized;
  return `<untrusted_tool_result name="${safeName}">\n${body}\n</untrusted_tool_result>`;
}

function getActionSecret() {
  return env.JWT_ACCESS_SECRET || "dev-chat-action-secret-key-minimum-32-chars";
}

/**
 * Creates an HMAC-SHA256 signed expiring confirmation token bound to userId, actionType, and payload.
 */
export function createActionToken({ userId, actionType, payload, ttlMs = ACTION_TOKEN_TTL_MS }) {
  const uid = String(userId || "");
  if (!uid) throw new Error("userId is required to sign an action confirmation token");
  const envelope = {
    v: 1,
    nonce: randomUUID(),
    userId: uid,
    actionType,
    payload,
    expiresAt: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  const sig = createHmac("sha256", getActionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * Verifies an HMAC-SHA256 action confirmation token and enforces userId ownership and expiry.
 */
export function verifyActionToken(token, expectedUserId) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    const err = new Error("Invalid confirmation token format.");
    err.statusCode = 400;
    err.code = "INVALID_ACTION_TOKEN";
    throw err;
  }
  const [encoded, providedSig] = token.split(".");
  if (!encoded || !providedSig) {
    const err = new Error("Malformed confirmation token.");
    err.statusCode = 400;
    err.code = "INVALID_ACTION_TOKEN";
    throw err;
  }
  const expectedSig = createHmac("sha256", getActionSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const err = new Error("Confirmation token signature is invalid.");
    err.statusCode = 403;
    err.code = "INVALID_ACTION_SIGNATURE";
    throw err;
  }
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    const err = new Error("Confirmation token payload is unreadable.");
    err.statusCode = 400;
    err.code = "INVALID_ACTION_TOKEN";
    throw err;
  }
  if (
    !envelope ||
    envelope.v !== 1 ||
    !envelope.nonce ||
    !envelope.userId ||
    !envelope.actionType
  ) {
    const err = new Error("Confirmation token is missing required claims.");
    err.statusCode = 400;
    err.code = "INVALID_ACTION_TOKEN";
    throw err;
  }
  if (String(envelope.userId) !== String(expectedUserId)) {
    const err = new Error("Confirmation token does not belong to the current user.");
    err.statusCode = 403;
    err.code = "ACTION_USER_MISMATCH";
    throw err;
  }
  if (!Number.isFinite(envelope.expiresAt) || Date.now() > envelope.expiresAt) {
    const err = new Error(
      "This action confirmation card has expired. Ask the assistant to propose it again.",
    );
    err.statusCode = 410;
    err.code = "ACTION_TOKEN_EXPIRED";
    throw err;
  }
  return envelope;
}

async function loadCatalogJobById(jobId) {
  if (!jobId) return null;
  if (!isMongoReady()) return null;
  const query = mongoose.isValidObjectId(jobId)
    ? { _id: jobId, status: "active" }
    : { sourceJobId: String(jobId), status: "active" };
  const job = await Job.findOne(query).lean();
  if (!job) return null;
  const detail = await JobDetail.findOne({ jobId: job._id })
    .select("description requirements")
    .lean();
  return {
    ...job,
    rawDescription: detail?.description || job.rawDescription || "",
    requirements: detail?.requirements || job.requirements || [],
  };
}

function requireContextUser(config) {
  const user = config?.configurable?.user;
  const userId = config?.configurable?.userId || (user?._id || user?.id)?.toString();
  if (!userId) {
    const err = new Error("Authenticated userId is required in tool execution context.");
    err.statusCode = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
  return { user: user || { _id: userId, id: userId, plan: "free" }, userId: String(userId) };
}

function recordToolOutcome(
  config,
  { toolName, sourceLabel, proposedAction = null, summary = null },
) {
  if (config?.configurable?.onToolComplete) {
    config.configurable.onToolComplete({
      toolName,
      sourceLabel,
      proposedAction,
      summary,
    });
  }
}

/**
 * Executes a single read or propose tool by name with strict Zod validation and userId scoping.
 */
export async function executeChatToolByName(toolName, rawArgs = {}, config = {}) {
  const tools = createChatTools(config);
  const found = tools.find((t) => t.name === toolName);
  if (!found) {
    const err = new Error(`Unknown chat tool: ${toolName}`);
    err.statusCode = 400;
    err.code = "UNKNOWN_TOOL";
    throw err;
  }
  const parsedArgs = found.schema.parse(rawArgs || {});
  return found.func(parsedArgs, config);
}

/**
 * Builds the LangChain DynamicStructuredTools for the authenticated user session.
 * Note: userId is NEVER accepted from model arguments; it is read exclusively from config.configurable.userId.
 */
export function createChatTools(defaultConfig = {}) {
  const resolveCtx = (callConfig) =>
    requireContextUser(callConfig?.configurable ? callConfig : defaultConfig);
  const notifyComplete = (callConfig, payload) =>
    recordToolOutcome(callConfig?.configurable ? callConfig : defaultConfig, payload);

  const getProfileSummaryTool = new DynamicStructuredTool({
    name: "get_profile_summary",
    description:
      "Get a concise summary of the current user's candidate profile, skills, experience years, target roles, active applications count, and latest interview score.",
    schema: z.object({}).strict(),
    func: async (_args, callConfig) => {
      const { user } = resolveCtx(callConfig);
      const snapshot = await getCandidateContext(user);
      const result = {
        profile: snapshot.card,
        suggestions: snapshot.suggestions,
      };
      notifyComplete(callConfig, {
        toolName: "get_profile_summary",
        sourceLabel: TOOL_SOURCE_LABELS.get_profile_summary,
        summary: `Profile loaded (${snapshot.card.skills?.length || 0} skills, ${snapshot.card.activeApplications || 0} active applications)`,
      });
      return wrapUntrustedToolResult("get_profile_summary", result);
    },
  });

  const getCareerProfileStatusTool = new DynamicStructuredTool({
    name: "get_career_profile_status",
    description:
      "Check which fields of the user's career profile (target roles, experience, home location, target locations, work preferences, compensation) are complete or missing.",
    schema: z.object({}).strict(),
    func: async (_args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const profile = await profileRepository.findByUserId(userId);
      const cp = profile?.careerProfile || {};
      const prefs = profile?.preferences || {};
      const hasTargetRoles = Boolean(
        (cp.targetRoles && cp.targetRoles.length > 0) ||
        (prefs.targetRoles && prefs.targetRoles.length > 0),
      );
      const hasExperience =
        Boolean(
          cp.experience?.confirmedYears !== null && cp.experience?.confirmedYears !== undefined,
        ) || Boolean(profile?.roles?.length);
      const hasHomeLocation = Boolean(cp.homeLocation?.countryCode || cp.homeLocation?.scope);
      const hasTargetLocations = Boolean(
        (cp.targetLocations && cp.targetLocations.length > 0) ||
        (prefs.preferredLocations && prefs.preferredLocations.length > 0),
      );
      const hasWorkPreferences = Boolean(cp.workPreferences?.workMode || prefs.remotePreference);
      const hasCompensation = Boolean(cp.compensation?.minimumAmount || prefs.minimumSalaryUsd);

      const missingFields = [];
      if (!hasTargetRoles) missingFields.push("targetRoles");
      if (!hasExperience) missingFields.push("experience");
      if (!hasHomeLocation) missingFields.push("homeLocation");
      if (!hasTargetLocations) missingFields.push("targetLocations");
      if (!hasWorkPreferences) missingFields.push("workPreferences");
      if (!hasCompensation) missingFields.push("compensation");

      const status = {
        completenessPercent: Math.round(((6 - missingFields.length) / 6) * 100),
        hasTargetRoles,
        hasExperience,
        hasHomeLocation,
        hasTargetLocations,
        hasWorkPreferences,
        hasCompensation,
        missingFields,
        targetRoles:
          cp.targetRoles?.map((r) => r.customRoleLabel || r.roleCode).filter(Boolean) ||
          prefs.targetRoles ||
          [],
        preferredLocations:
          cp.targetLocations?.map((l) => l.cityCode || l.countryCode || l.scope).filter(Boolean) ||
          prefs.preferredLocations ||
          [],
        workMode: cp.workPreferences?.workMode || prefs.remotePreference || "any",
      };
      notifyComplete(callConfig, {
        toolName: "get_career_profile_status",
        sourceLabel: TOOL_SOURCE_LABELS.get_career_profile_status,
        summary: `Career profile ${status.completenessPercent}% complete`,
      });
      return wrapUntrustedToolResult("get_career_profile_status", status);
    },
  });

  const searchJobsTool = new DynamicStructuredTool({
    name: "search_jobs",
    description:
      "Search active jobs in the catalog using optional keyword, location, remoteType, or countryCode filters, scored against the user's profile.",
    schema: z
      .object({
        query: z.string().trim().max(120).optional().default(""),
        location: z.string().trim().max(100).optional().default(""),
        remoteType: z.enum(["", "remote", "hybrid", "onsite"]).optional().default(""),
        countryCode: z.string().trim().max(2).optional().default(""),
        limit: z.number().int().min(1).max(10).optional().default(5),
      })
      .strict(),
    func: async (args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const profile = await profileRepository.findByUserId(userId);
      const hiddenJobIds = isMongoReady() ? await HiddenJob.distinct("jobId", { userId }) : [];
      const searchResult = await jobIngestionService
        .searchJobs({
          q: args.query || "",
          location: args.location || "",
          remoteType: args.remoteType || "",
          countryCode: args.countryCode ? args.countryCode.toUpperCase() : "",
          eligibilityCountryCodes: profileApplicantCountries(profile || {}),
          page: 1,
          limit: Math.min(10, args.limit || 5),
          excludeJobIds: hiddenJobIds,
        })
        .catch(() => ({ jobs: [], total: 0 }));

      const jobs = (searchResult.jobs || []).slice(0, args.limit || 5).map((job) => {
        const match = profile ? scoreJobMatch(profile, job) : null;
        const eligibility = match?.eligibility || classifyEligibility(job, profile || {}).status;
        return {
          jobId: String(job._id || job.sourceJobId || ""),
          title: job.title,
          company: job.company,
          location: job.location || "",
          remoteType: job.remoteType || "unknown",
          score: match?.score ?? null,
          scoreBand: match?.scoreBand ?? null,
          matchingSkills: (match?.matchingSkills || []).slice(0, 6),
          missingSkills: (match?.missingSkills || []).slice(0, 5),
          eligibility,
          riskFlags: getJobRiskFlags(job),
        };
      });

      const payload = {
        totalFound: searchResult.total ?? jobs.length,
        jobs,
      };
      notifyComplete(callConfig, {
        toolName: "search_jobs",
        sourceLabel: TOOL_SOURCE_LABELS.search_jobs,
        summary: `Found ${jobs.length} matching jobs`,
      });
      return wrapUntrustedToolResult("search_jobs", payload);
    },
  });

  const getJobTool = new DynamicStructuredTool({
    name: "get_job",
    description:
      "Get detailed information, requirements, eligibility, and profile match breakdown for a specific catalog job by jobId.",
    schema: z
      .object({
        jobId: z.string().trim().min(1).max(100),
      })
      .strict(),
    func: async ({ jobId }, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const job = await loadCatalogJobById(jobId);
      if (!job) {
        notifyComplete(callConfig, {
          toolName: "get_job",
          sourceLabel: TOOL_SOURCE_LABELS.get_job,
          summary: "Job not found",
        });
        return wrapUntrustedToolResult("get_job", {
          error: "NOT_FOUND",
          message: "Job not found or no longer active.",
        });
      }
      const profile = await profileRepository.findByUserId(userId);
      const match = profile ? scoreJobMatch(profile, job) : null;
      const eligibility = classifyEligibility(job, profile || {});
      const payload = {
        jobId: String(job._id),
        title: job.title,
        company: job.company,
        location: job.location || "",
        remoteType: job.remoteType || "unknown",
        requirements: (job.requirements || []).slice(0, 12),
        tags: (job.tags || []).slice(0, 10),
        descriptionExcerpt: String(job.rawDescription || "").slice(0, 1000),
        score: match?.score ?? null,
        scoreBand: match?.scoreBand ?? null,
        matchingSkills: (match?.matchingSkills || []).slice(0, 8),
        missingSkills: (match?.missingSkills || []).slice(0, 8),
        eligibility: eligibility.status,
        eligibilityReason: eligibility.reason || "",
        riskFlags: getJobRiskFlags(job),
      };
      notifyComplete(callConfig, {
        toolName: "get_job",
        sourceLabel: TOOL_SOURCE_LABELS.get_job,
        summary: `Loaded job: ${job.title} at ${job.company}`,
      });
      return wrapUntrustedToolResult("get_job", payload);
    },
  });

  const runResumeMatchTool = new DynamicStructuredTool({
    name: "run_resume_match",
    description:
      "Run deterministic resume-to-job match analysis for the current user's resume against a catalog jobId or tracked applicationId.",
    schema: z
      .object({
        jobId: z.string().trim().max(100).optional(),
        applicationId: z.string().trim().max(100).optional(),
        resumeId: z.string().trim().max(100).optional(),
      })
      .strict(),
    func: async (args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const resumes = await profileRepository.findResumesByUserId(userId);
      const selectedResume = args.resumeId
        ? resumes.find((r) => String(r._id) === String(args.resumeId))
        : resumes[0];
      if (!selectedResume) {
        notifyComplete(callConfig, {
          toolName: "run_resume_match",
          sourceLabel: TOOL_SOURCE_LABELS.run_resume_match,
          summary: "No resume uploaded yet",
        });
        return wrapUntrustedToolResult("run_resume_match", {
          error: "RESUME_NOT_FOUND",
          message: "Upload a resume first so we can score your match against this role.",
        });
      }

      const profile = await profileRepository.findByUserId(userId);
      if (!profile) {
        return wrapUntrustedToolResult("run_resume_match", {
          error: "PROFILE_NOT_FOUND",
          message: "Profile facts are not available yet. Upload and parse a resume first.",
        });
      }

      let targetJob = null;
      let sourceLabel = "";
      if (args.jobId) {
        targetJob = await loadCatalogJobById(args.jobId);
        if (!targetJob) {
          return wrapUntrustedToolResult("run_resume_match", {
            error: "NOT_FOUND",
            message: "The specified job could not be found.",
          });
        }
        sourceLabel = `${targetJob.title} at ${targetJob.company}`;
      } else if (args.applicationId) {
        const app = await applicationRepository.findOwnedById(args.applicationId, userId);
        if (!app) {
          return wrapUntrustedToolResult("run_resume_match", {
            error: "NOT_FOUND",
            message: "Application not found for the current user.",
          });
        }
        const catalogJob = app.jobId ? await loadCatalogJobById(app.jobId) : null;
        targetJob = catalogJob || {
          title: app.role,
          company: app.company,
          location: app.location || "",
          rawDescription: app.notes || `${app.role} at ${app.company}`,
          requirements: [],
          tags: [],
        };
        sourceLabel = `${app.role} at ${app.company}`;
      } else {
        return wrapUntrustedToolResult("run_resume_match", {
          error: "MISSING_TARGET",
          message: "Provide either a jobId or applicationId to run a resume match.",
        });
      }

      const scored = await scoreResumeForJob({
        resume: selectedResume,
        profile,
        job: targetJob,
      });

      const payload = {
        resumeId: String(selectedResume._id),
        resumeFilename: selectedResume.originalFilename || "Resume",
        jobTitle: targetJob.title,
        company: targetJob.company,
        score: scored.match.score,
        band: scored.match.band,
        matchedCount: scored.match.matched,
        missingCount: scored.match.missing,
        mustHaveMatched: (scored.match.groups?.mustHave || [])
          .filter((item) => item.matched)
          .map((item) => item.term)
          .slice(0, 8),
        mustHaveMissing: (scored.match.groups?.mustHave || [])
          .filter((item) => !item.matched)
          .map((item) => item.term)
          .slice(0, 8),
        niceToHaveMissing: (scored.match.groups?.niceToHave || [])
          .filter((item) => !item.matched)
          .map((item) => item.term)
          .slice(0, 6),
        atsReadinessScore: scored.atsReadiness?.score ?? null,
        evidence: (scored.match.evidence || []).slice(0, 5),
      };
      notifyComplete(callConfig, {
        toolName: "run_resume_match",
        sourceLabel: TOOL_SOURCE_LABELS.run_resume_match,
        summary: `Resume match for ${sourceLabel}: ${scored.match.score}% (${scored.match.band})`,
      });
      return wrapUntrustedToolResult("run_resume_match", payload);
    },
  });

  const listApplicationsTool = new DynamicStructuredTool({
    name: "list_applications",
    description:
      "List the current user's job applications in their tracker with optional stage, priority, search, or followUp filter.",
    schema: z
      .object({
        stage: z
          .enum(["", "saved", "applied", "screening", "interviewing", "offer", "rejected"])
          .optional()
          .default(""),
        priority: z.enum(["", "high", "medium", "low"]).optional().default(""),
        followUp: z.enum(["", "overdue", "due-soon"]).optional().default(""),
        search: z.string().trim().max(100).optional().default(""),
        limit: z.number().int().min(1).max(15).optional().default(8),
      })
      .strict(),
    func: async (args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const filters = {
        stages: args.stage ? [args.stage] : [],
        priority: args.priority || undefined,
        followUp: args.followUp || undefined,
        search: args.search || undefined,
        sort: "recommended",
      };
      const [apps, stats] = await Promise.all([
        applicationRepository.findByUserId(userId, filters),
        applicationRepository.getBoardStats(userId),
      ]);
      const items = apps.slice(0, args.limit || 8).map((app) => ({
        applicationId: String(app._id),
        company: app.company,
        role: app.role,
        status: app.status,
        priority: app.priority || "medium",
        location: app.location || "",
        nextFollowUpAt: app.nextFollowUpAt || null,
        reminderEnabled: Boolean(app.reminderEnabled),
        updatedAt: app.updatedAt || app.createdAt || null,
      }));
      const payload = {
        stats,
        totalMatching: apps.length,
        applications: items,
      };
      notifyComplete(callConfig, {
        toolName: "list_applications",
        sourceLabel: TOOL_SOURCE_LABELS.list_applications,
        summary: `Checked ${items.length} of ${apps.length} applications`,
      });
      return wrapUntrustedToolResult("list_applications", payload);
    },
  });

  const getApplicationTool = new DynamicStructuredTool({
    name: "get_application",
    description:
      "Get full details, notes, timeline, and follow-up status for a specific application owned by the current user.",
    schema: z
      .object({
        applicationId: z.string().trim().min(1).max(100),
      })
      .strict(),
    func: async ({ applicationId }, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const app = await applicationRepository.findOwnedById(applicationId, userId);
      if (!app) {
        notifyComplete(callConfig, {
          toolName: "get_application",
          sourceLabel: TOOL_SOURCE_LABELS.get_application,
          summary: "Application not found",
        });
        return wrapUntrustedToolResult("get_application", {
          error: "NOT_FOUND",
          message: "Application not found.",
        });
      }
      const payload = {
        applicationId: String(app._id),
        jobId: app.jobId || "",
        company: app.company,
        role: app.role,
        status: app.status,
        priority: app.priority || "medium",
        location: app.location || "",
        salaryMin: app.salaryMin ?? null,
        salaryMax: app.salaryMax ?? null,
        notes: String(app.notes || "").slice(0, 600),
        nextFollowUpAt: app.nextFollowUpAt || null,
        reminderEnabled: Boolean(app.reminderEnabled),
        followUpDraft: app.followUpDraft
          ? {
              subject: app.followUpDraft.subject || "",
              body: String(app.followUpDraft.body || "").slice(0, 500),
              status: app.followUpDraft.status || "none",
            }
          : null,
        timeline: (app.timeline || []).slice(-6),
      };
      notifyComplete(callConfig, {
        toolName: "get_application",
        sourceLabel: TOOL_SOURCE_LABELS.get_application,
        summary: `Loaded application: ${app.role} at ${app.company}`,
      });
      return wrapUntrustedToolResult("get_application", payload);
    },
  });

  const getInterviewReportsTool = new DynamicStructuredTool({
    name: "get_interview_reports",
    description:
      "List the current user's recent mock interview sessions and their report scores, strengths, and focus areas.",
    schema: z
      .object({
        limit: z.number().int().min(1).max(10).optional().default(5),
      })
      .strict(),
    func: async ({ limit }, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      if (!isMongoReady()) {
        notifyComplete(callConfig, {
          toolName: "get_interview_reports",
          sourceLabel: TOOL_SOURCE_LABELS.get_interview_reports,
          summary: "0 interview reports",
        });
        return wrapUntrustedToolResult("get_interview_reports", { sessions: [] });
      }
      const sessions = await InterviewSession.find({ userId })
        .sort({ createdAt: -1 })
        .limit(Math.min(10, limit || 5))
        .lean();
      const sessionIds = sessions.map((s) => s._id);
      const reports = sessionIds.length
        ? await InterviewReport.find({ userId, interviewId: { $in: sessionIds } }).lean()
        : [];
      const reportBySessionId = new Map(reports.map((r) => [String(r.interviewId), r]));
      const items = sessions.map((s) => {
        const rep = reportBySessionId.get(String(s._id));
        return {
          interviewId: String(s._id),
          role: s.role,
          level: s.level,
          mode: s.mode,
          status: s.status,
          createdAt: s.createdAt,
          overallScore: rep?.report?.overallScore ?? null,
          readiness: rep?.report?.readiness ?? null,
          strengths: (rep?.report?.strengths || []).slice(0, 4),
          focusAreas: (rep?.report?.focusAreas || []).slice(0, 4),
        };
      });
      notifyComplete(callConfig, {
        toolName: "get_interview_reports",
        sourceLabel: TOOL_SOURCE_LABELS.get_interview_reports,
        summary: `Loaded ${items.length} interview sessions`,
      });
      return wrapUntrustedToolResult("get_interview_reports", { sessions: items });
    },
  });

  const getInterviewReportTool = new DynamicStructuredTool({
    name: "get_interview_report",
    description:
      "Get the full mock interview evaluation report (scores, dimensions, strengths, focus areas, priority actions, and 7-day practice plan) for a specific interviewId owned by the current user.",
    schema: z
      .object({
        interviewId: z.string().trim().min(1).max(100),
      })
      .strict(),
    func: async ({ interviewId }, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      if (!isMongoReady() || !mongoose.isValidObjectId(interviewId)) {
        return wrapUntrustedToolResult("get_interview_report", {
          error: "NOT_FOUND",
          message: "Interview report not found.",
        });
      }
      const [session, reportDoc] = await Promise.all([
        InterviewSession.findOne({ _id: interviewId, userId }).lean(),
        InterviewReport.findOne({ interviewId, userId }).lean(),
      ]);
      if (!session) {
        return wrapUntrustedToolResult("get_interview_report", {
          error: "NOT_FOUND",
          message: "Interview report not found.",
        });
      }
      const report = reportDoc?.report || null;
      const payload = {
        interviewId: String(session._id),
        role: session.role,
        level: session.level,
        mode: session.mode,
        status: session.status,
        report: report
          ? {
              overallScore: report.overallScore,
              readiness: report.readiness,
              summary: report.summary,
              dimensions: report.dimensions,
              strengths: report.strengths || [],
              focusAreas: report.focusAreas || [],
              priorityActions: report.priorityActions || [],
              practicePlan: report.practicePlan || [],
            }
          : null,
      };
      notifyComplete(callConfig, {
        toolName: "get_interview_report",
        sourceLabel: TOOL_SOURCE_LABELS.get_interview_report,
        summary: `Loaded interview report for ${session.role}`,
      });
      return wrapUntrustedToolResult("get_interview_report", payload);
    },
  });

  const getResumeFactsTool = new DynamicStructuredTool({
    name: "get_resume_facts",
    description:
      "Get the current user's source-grounded resume facts (roles, achievements, skills, education) and uploaded resume metadata.",
    schema: z.object({}).strict(),
    func: async (_args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const [profile, resumes] = await Promise.all([
        profileRepository.findByUserId(userId),
        profileRepository.findResumesByUserId(userId),
      ]);
      const payload = {
        resumes: (resumes || []).slice(0, 5).map((r) => ({
          resumeId: String(r._id),
          filename: r.originalFilename || "Resume",
          createdAt: r.createdAt,
        })),
        roles: (profile?.roles || []).slice(0, 8).map((role) => ({
          factId: role.factId || "",
          title: role.title || "",
          company: role.company || "",
          startDate: role.startDate || "",
          endDate: role.endDate || (role.isCurrent ? "present" : ""),
          achievements: (role.achievements || []).slice(0, 4).map((a) => ({
            factId: a.factId || "",
            bullet: String(a.bullet || "").slice(0, 220),
          })),
        })),
        skills: (profile?.skills || [])
          .slice(0, 25)
          .map((s) => s.name)
          .filter(Boolean),
        education: (profile?.education || []).slice(0, 5).map((e) => ({
          factId: e.factId || "",
          degree: e.degree || "",
          institution: e.institution || "",
          graduationYear: e.graduationYear || null,
        })),
      };
      notifyComplete(callConfig, {
        toolName: "get_resume_facts",
        sourceLabel: TOOL_SOURCE_LABELS.get_resume_facts,
        summary: `Loaded ${payload.roles.length} roles and ${payload.skills.length} skills from resume`,
      });
      return wrapUntrustedToolResult("get_resume_facts", payload);
    },
  });

  const searchMemoriesTool = new DynamicStructuredTool({
    name: "search_memories",
    description:
      "Search the current user's consent-gated long-term career preferences and goals stored in memory.",
    schema: z
      .object({
        query: z.string().trim().min(1).max(200),
      })
      .strict(),
    func: async ({ query }, callConfig) => {
      const { user, userId } = resolveCtx(callConfig);
      const memories = await longTermMemory.retrieveRelevant(userId, query, 5, { user });
      const snapshot = await getCandidateContext(user).catch(() => ({ card: {} }));
      const resolved = longTermMemory.resolveProfileMemoryConflicts(memories, snapshot.card);
      const payload = {
        consentGranted: longTermMemory.hasMemoryConsent(user),
        memoriesPaused: Boolean(user?.memoriesPaused),
        memories: resolved.map((m) => ({
          id: String(m._id || m.id || ""),
          type: m.type,
          key: m.key || "",
          content: m.content,
        })),
      };
      notifyComplete(callConfig, {
        toolName: "search_memories",
        sourceLabel: TOOL_SOURCE_LABELS.search_memories,
        summary: `Retrieved ${payload.memories.length} relevant memories`,
      });
      return wrapUntrustedToolResult("search_memories", payload);
    },
  });

  // ============================================================================
  // Propose-and-confirm Action Tools (never mutate state directly; return signed card)
  // ============================================================================

  const proposeAddJobToTrackerTool = new DynamicStructuredTool({
    name: "propose_add_job_to_tracker",
    description:
      "Propose adding a job to the user's application tracker. Does not write to the database until the user clicks Confirm on the action card.",
    schema: z
      .object({
        jobId: z.string().trim().max(100).optional(),
        company: z.string().trim().min(1).max(160).optional(),
        role: z.string().trim().min(1).max(160).optional(),
        location: z.string().trim().max(160).optional().default(""),
        status: z.enum(["saved", "applied"]).optional().default("saved"),
        priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
        notes: z.string().trim().max(500).optional().default(""),
      })
      .strict(),
    func: async (args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      let company = args.company || "";
      let role = args.role || "";
      let location = args.location || "";
      let source = "chat_assistant";
      let jobUrl = "";

      if (args.jobId) {
        const catalogJob = await loadCatalogJobById(args.jobId);
        if (catalogJob) {
          company = company || catalogJob.company;
          role = role || catalogJob.title;
          location = location || catalogJob.location || "";
          source = catalogJob.sourceBoard || "catalog";
          jobUrl = catalogJob.sourceUrl || "";
        }
      }

      if (!company || !role) {
        return wrapUntrustedToolResult("propose_add_job_to_tracker", {
          error: "VALIDATION_ERROR",
          message:
            "Both company and role (or a valid catalog jobId) are required to propose tracking a job.",
        });
      }

      const actionPayload = {
        jobId: args.jobId || "",
        company,
        role,
        location,
        status: args.status || "saved",
        priority: args.priority || "medium",
        notes: args.notes || "",
        source,
        jobUrl,
      };
      const confirmationToken = createActionToken({
        userId,
        actionType: "add_job_to_tracker",
        payload: actionPayload,
      });
      const proposedAction = {
        actionId: `act_${randomUUID()}`,
        actionType: "add_job_to_tracker",
        title: `Add ${role} at ${company} to Application Tracker`,
        description: `Stage: ${actionPayload.status} · Priority: ${actionPayload.priority}${location ? ` · Location: ${location}` : ""}`,
        payload: actionPayload,
        confirmationToken,
        requiresConfirmation: true,
      };
      notifyComplete(callConfig, {
        toolName: "propose_add_job_to_tracker",
        sourceLabel: TOOL_SOURCE_LABELS.propose_add_job_to_tracker,
        proposedAction,
        summary: `Proposed adding ${role} at ${company} to tracker`,
      });
      return wrapUntrustedToolResult("propose_add_job_to_tracker", {
        status: "PROPOSED_AWAITING_USER_CONFIRMATION",
        proposedAction,
      });
    },
  });

  const proposeSetFollowUpTool = new DynamicStructuredTool({
    name: "propose_set_follow_up",
    description:
      "Propose scheduling or updating a follow-up reminder date on an existing application in the user's tracker. Requires user confirmation.",
    schema: z
      .object({
        applicationId: z.string().trim().min(1).max(100),
        followUpInDays: z.number().int().min(1).max(90).optional().default(7),
        nextFollowUpAt: z.string().datetime().optional(),
        reminderEnabled: z.boolean().optional().default(true),
      })
      .strict(),
    func: async (args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const app = await applicationRepository.findOwnedById(args.applicationId, userId);
      if (!app) {
        return wrapUntrustedToolResult("propose_set_follow_up", {
          error: "NOT_FOUND",
          message: "Application not found.",
        });
      }
      const dueDate = args.nextFollowUpAt
        ? new Date(args.nextFollowUpAt)
        : new Date(Date.now() + (args.followUpInDays || 7) * 86_400_000);
      const isoDate = dueDate.toISOString();

      const actionPayload = {
        applicationId: String(app._id),
        company: app.company,
        role: app.role,
        nextFollowUpAt: isoDate,
        reminderEnabled: args.reminderEnabled !== false,
      };
      const confirmationToken = createActionToken({
        userId,
        actionType: "set_follow_up",
        payload: actionPayload,
      });
      const proposedAction = {
        actionId: `act_${randomUUID()}`,
        actionType: "set_follow_up",
        title: `Schedule follow-up for ${app.role} at ${app.company}`,
        description: `Follow-up date: ${isoDate.slice(0, 10)} · Reminder enabled`,
        payload: actionPayload,
        confirmationToken,
        requiresConfirmation: true,
      };
      notifyComplete(callConfig, {
        toolName: "propose_set_follow_up",
        sourceLabel: TOOL_SOURCE_LABELS.propose_set_follow_up,
        proposedAction,
        summary: `Proposed follow-up on ${isoDate.slice(0, 10)} for ${app.company}`,
      });
      return wrapUntrustedToolResult("propose_set_follow_up", {
        status: "PROPOSED_AWAITING_USER_CONFIRMATION",
        proposedAction,
      });
    },
  });

  const proposeSetApplicationPriorityTool = new DynamicStructuredTool({
    name: "propose_set_application_priority",
    description:
      "Propose changing the priority (high, medium, low) of an existing application in the user's tracker. Requires user confirmation.",
    schema: z
      .object({
        applicationId: z.string().trim().min(1).max(100),
        priority: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    func: async ({ applicationId, priority }, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const app = await applicationRepository.findOwnedById(applicationId, userId);
      if (!app) {
        return wrapUntrustedToolResult("propose_set_application_priority", {
          error: "NOT_FOUND",
          message: "Application not found.",
        });
      }
      const actionPayload = {
        applicationId: String(app._id),
        company: app.company,
        role: app.role,
        previousPriority: app.priority || "medium",
        priority,
      };
      const confirmationToken = createActionToken({
        userId,
        actionType: "set_application_priority",
        payload: actionPayload,
      });
      const proposedAction = {
        actionId: `act_${randomUUID()}`,
        actionType: "set_application_priority",
        title: `Set priority to ${priority.toUpperCase()} for ${app.role} at ${app.company}`,
        description: `Changes priority from ${actionPayload.previousPriority} to ${priority}`,
        payload: actionPayload,
        confirmationToken,
        requiresConfirmation: true,
      };
      notifyComplete(callConfig, {
        toolName: "propose_set_application_priority",
        sourceLabel: TOOL_SOURCE_LABELS.propose_set_application_priority,
        proposedAction,
        summary: `Proposed setting priority to ${priority} for ${app.company}`,
      });
      return wrapUntrustedToolResult("propose_set_application_priority", {
        status: "PROPOSED_AWAITING_USER_CONFIRMATION",
        proposedAction,
      });
    },
  });

  const proposeStartPracticeInterviewTool = new DynamicStructuredTool({
    name: "propose_start_practice_interview",
    description:
      "Propose creating a tailored mock interview session for a target role, seniority level, and interview mode. Requires user confirmation.",
    schema: z
      .object({
        role: z.string().trim().min(2).max(120),
        level: z.enum(["fresher", "mid", "senior"]).optional().default("mid"),
        mode: z
          .enum(["behavioral", "technical", "hr", "aptitude_case", "founder"])
          .optional()
          .default("behavioral"),
        durationMinutes: z.enum(["15", "30"]).optional().default("15"),
        jobId: z.string().trim().max(100).optional(),
        applicationId: z.string().trim().max(100).optional(),
      })
      .strict(),
    func: async (args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const resumes = await profileRepository.findResumesByUserId(userId);
      const primaryResume = resumes[0];
      if (!primaryResume) {
        return wrapUntrustedToolResult("propose_start_practice_interview", {
          error: "RESUME_REQUIRED",
          message: "Upload a resume first so we can generate a grounded mock interview session.",
        });
      }

      let jobDescription = "";
      if (args.jobId) {
        const job = await loadCatalogJobById(args.jobId);
        if (job) jobDescription = String(job.rawDescription || "").slice(0, 2500);
      } else if (args.applicationId) {
        const app = await applicationRepository.findOwnedById(args.applicationId, userId);
        if (app)
          jobDescription = String(app.notes || `${app.role} at ${app.company}`).slice(0, 2500);
      }

      const actionPayload = {
        resumeId: String(primaryResume._id),
        role: args.role,
        level: args.level || "mid",
        mode: args.mode || "behavioral",
        durationMinutes: Number(args.durationMinutes || 15),
        jobDescription,
      };
      const confirmationToken = createActionToken({
        userId,
        actionType: "start_practice_interview",
        payload: actionPayload,
      });
      const proposedAction = {
        actionId: `act_${randomUUID()}`,
        actionType: "start_practice_interview",
        title: `Start ${actionPayload.mode} mock interview for ${actionPayload.role}`,
        description: `Level: ${actionPayload.level} · Duration: ${actionPayload.durationMinutes} min · Resume: ${primaryResume.originalFilename || "Latest Resume"}`,
        payload: actionPayload,
        confirmationToken,
        requiresConfirmation: true,
      };
      notifyComplete(callConfig, {
        toolName: "propose_start_practice_interview",
        sourceLabel: TOOL_SOURCE_LABELS.propose_start_practice_interview,
        proposedAction,
        summary: `Proposed ${actionPayload.mode} mock interview for ${actionPayload.role}`,
      });
      return wrapUntrustedToolResult("propose_start_practice_interview", {
        status: "PROPOSED_AWAITING_USER_CONFIRMATION",
        proposedAction,
      });
    },
  });

  const proposeOpenResumeMatchTool = new DynamicStructuredTool({
    name: "propose_open_resume_match",
    description:
      "Propose generating and opening a persisted Resume Match report for a specific catalog jobId or tracked applicationId. Requires user confirmation.",
    schema: z
      .object({
        jobId: z.string().trim().max(100).optional(),
        applicationId: z.string().trim().max(100).optional(),
      })
      .strict(),
    func: async (args, callConfig) => {
      const { userId } = resolveCtx(callConfig);
      const resumes = await profileRepository.findResumesByUserId(userId);
      const primaryResume = resumes[0];
      if (!primaryResume) {
        return wrapUntrustedToolResult("propose_open_resume_match", {
          error: "RESUME_REQUIRED",
          message: "Upload a resume first to generate a full Resume Match report.",
        });
      }

      let targetTitle = "Selected Role";
      let targetCompany = "";
      if (args.jobId) {
        const job = await loadCatalogJobById(args.jobId);
        if (!job) {
          return wrapUntrustedToolResult("propose_open_resume_match", {
            error: "NOT_FOUND",
            message: "Job not found.",
          });
        }
        targetTitle = job.title;
        targetCompany = job.company;
      } else if (args.applicationId) {
        const app = await applicationRepository.findOwnedById(args.applicationId, userId);
        if (!app) {
          return wrapUntrustedToolResult("propose_open_resume_match", {
            error: "NOT_FOUND",
            message: "Application not found.",
          });
        }
        targetTitle = app.role;
        targetCompany = app.company;
      } else {
        return wrapUntrustedToolResult("propose_open_resume_match", {
          error: "MISSING_TARGET",
          message: "Provide a jobId or applicationId to propose a Resume Match report.",
        });
      }

      const actionPayload = {
        resumeId: String(primaryResume._id),
        jobId: args.jobId || "",
        applicationId: args.applicationId || "",
        title: targetTitle,
        company: targetCompany,
      };
      const confirmationToken = createActionToken({
        userId,
        actionType: "open_resume_match",
        payload: actionPayload,
      });
      const proposedAction = {
        actionId: `act_${randomUUID()}`,
        actionType: "open_resume_match",
        title: `Open Resume Match Report for ${targetTitle}${targetCompany ? ` at ${targetCompany}` : ""}`,
        description: `Scores ${primaryResume.originalFilename || "your resume"} against ${targetTitle} requirements`,
        payload: actionPayload,
        confirmationToken,
        requiresConfirmation: true,
      };
      notifyComplete(callConfig, {
        toolName: "propose_open_resume_match",
        sourceLabel: TOOL_SOURCE_LABELS.propose_open_resume_match,
        proposedAction,
        summary: `Proposed opening Resume Match for ${targetTitle}`,
      });
      return wrapUntrustedToolResult("propose_open_resume_match", {
        status: "PROPOSED_AWAITING_USER_CONFIRMATION",
        proposedAction,
      });
    },
  });

  return [
    getProfileSummaryTool,
    getCareerProfileStatusTool,
    searchJobsTool,
    getJobTool,
    runResumeMatchTool,
    listApplicationsTool,
    getApplicationTool,
    getInterviewReportsTool,
    getInterviewReportTool,
    getResumeFactsTool,
    searchMemoriesTool,
    proposeAddJobToTrackerTool,
    proposeSetFollowUpTool,
    proposeSetApplicationPriorityTool,
    proposeStartPracticeInterviewTool,
    proposeOpenResumeMatchTool,
  ];
}

/**
 * Verifies a signed action confirmation token and executes the underlying service mutation
 * with idempotency and AuditLog persistence.
 */
export async function confirmProposedAction({
  user,
  token,
  idempotencyKey,
  ipAddress = null,
  userAgent = null,
}) {
  const userId = (user?._id || user?.id)?.toString();
  if (!userId) {
    const err = new Error("Authentication required.");
    err.statusCode = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
  const cleanIdempotencyKey = String(idempotencyKey || "").trim();
  if (!cleanIdempotencyKey || cleanIdempotencyKey.length < 8) {
    const err = new Error("A valid idempotencyKey (min 8 chars) is required to confirm an action.");
    err.statusCode = 400;
    err.code = "INVALID_IDEMPOTENCY_KEY";
    throw err;
  }

  const envelope = verifyActionToken(token, userId);
  const nonceKey = `${userId}:nonce:${envelope.nonce}`;
  const idemKey = `${userId}:idem:${cleanIdempotencyKey}`;

  // Check in-memory idempotency / replay store first
  if (inMemoryConsumedActions.has(idemKey)) {
    return { ...inMemoryConsumedActions.get(idemKey), idempotentReplay: true };
  }
  if (inMemoryConsumedActions.has(nonceKey)) {
    const err = new Error("This confirmation card has already been used.");
    err.statusCode = 409;
    err.code = "ACTION_ALREADY_CONFIRMED";
    throw err;
  }

  if (isMongoReady() && mongoose.isValidObjectId(userId)) {
    const existingByIdem = await AuditLog.findOne({
      userId,
      action: "CHAT_ACTION_CONFIRMED",
      "metadata.idempotencyKey": cleanIdempotencyKey,
    }).lean();
    if (existingByIdem && existingByIdem.metadata?.result) {
      return { ...existingByIdem.metadata.result, idempotentReplay: true };
    }
    const existingByNonce = await AuditLog.findOne({
      userId,
      action: "CHAT_ACTION_CONFIRMED",
      "metadata.nonce": envelope.nonce,
    }).lean();
    if (existingByNonce) {
      const err = new Error("This confirmation card has already been used.");
      err.statusCode = 409;
      err.code = "ACTION_ALREADY_CONFIRMED";
      throw err;
    }
  }

  const { actionType, payload } = envelope;
  let executionResult;

  if (actionType === "add_job_to_tracker") {
    const created = await applicationRepository.create({
      userId,
      jobId: payload.jobId || `manual_${randomUUID()}`,
      company: payload.company,
      role: payload.role,
      location: payload.location || "",
      status: payload.status || "saved",
      priority: payload.priority || "medium",
      notes: payload.notes || "",
      source: payload.source || "chat_assistant",
      jobUrl: payload.jobUrl || "",
      reminderEnabled: false,
      reminderStatus: "none",
    });
    await del(CacheKeys.response(userId, "kanban", 1));
    await invalidateCandidateContext(userId);
    executionResult = {
      actionType,
      status: "confirmed",
      message: `Added ${created.role} at ${created.company} to your application tracker.`,
      resourceId: String(created._id),
      redirectUrl: `/app/applications?applicationId=${created._id}`,
      application: {
        id: String(created._id),
        company: created.company,
        role: created.role,
        status: created.status,
        priority: created.priority,
      },
    };
  } else if (actionType === "set_follow_up") {
    const app = await applicationRepository.findOwnedById(payload.applicationId, userId);
    if (!app) {
      const err = new Error("Application not found.");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    const nextFollowUpAt = new Date(payload.nextFollowUpAt);
    const reminderEnabled = payload.reminderEnabled !== false;
    const transition = applicationReminderTransition({
      application: app,
      nextFollowUpAt,
      reminderEnabled,
    });
    const updates = {
      nextFollowUpAt,
      reminderEnabled,
      reminderStatus: transition.enabled ? "scheduled" : "none",
      reminderSentAt: null,
    };
    const updated = await applicationRepository.update(app._id, updates, { activity: true });
    if (transition.cancel) await cancelApplicationReminder(app).catch(() => {});
    if (transition.schedule) {
      await scheduleApplicationReminder(updated).catch((err) => {
        logger.warn({ appId: app._id, err: err.message }, "Follow-up reminder queue unavailable");
      });
    }
    await del(CacheKeys.response(userId, "kanban", 1));
    await invalidateCandidateContext(userId);
    executionResult = {
      actionType,
      status: "confirmed",
      message: `Scheduled follow-up for ${app.role} at ${app.company} on ${nextFollowUpAt.toISOString().slice(0, 10)}.`,
      resourceId: String(app._id),
      redirectUrl: `/app/applications?applicationId=${app._id}`,
      application: {
        id: String(app._id),
        company: app.company,
        role: app.role,
        nextFollowUpAt: nextFollowUpAt.toISOString(),
        reminderEnabled,
      },
    };
  } else if (actionType === "set_application_priority") {
    const app = await applicationRepository.findOwnedById(payload.applicationId, userId);
    if (!app) {
      const err = new Error("Application not found.");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    const updated = await applicationRepository.update(
      app._id,
      { priority: payload.priority },
      { activity: true },
    );
    await del(CacheKeys.response(userId, "kanban", 1));
    await invalidateCandidateContext(userId);
    executionResult = {
      actionType,
      status: "confirmed",
      message: `Updated priority for ${app.role} at ${app.company} to ${payload.priority}.`,
      resourceId: String(app._id),
      redirectUrl: `/app/applications?applicationId=${app._id}`,
      application: {
        id: String(app._id),
        company: app.company,
        role: app.role,
        priority: updated?.priority || payload.priority,
      },
    };
  } else if (actionType === "start_practice_interview") {
    const session = await interviewSessionService.create(
      user,
      {
        resumeId: payload.resumeId,
        role: payload.role,
        level: payload.level || "mid",
        mode: payload.mode || "behavioral",
        durationMinutes: Number(payload.durationMinutes || 15),
        jobDescription: payload.jobDescription || "",
      },
      { idempotencyKey: cleanIdempotencyKey },
    );
    executionResult = {
      actionType,
      status: "confirmed",
      message: `Created ${session.mode} practice interview session for ${session.role}.`,
      resourceId: session.id,
      redirectUrl: `/app/interviews?sessionId=${session.id}`,
      interviewSession: session,
    };
  } else if (actionType === "open_resume_match") {
    const resume = await profileRepository.findResumeByIdAndUserId(payload.resumeId, userId);
    const profile = await profileRepository.findByUserId(userId);
    if (!resume || !profile) {
      const err = new Error("Resume or profile not found.");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    let jobData = {
      title: payload.title || "Target Role",
      company: payload.company || "",
      rawDescription: `${payload.title || ""} ${payload.company || ""}`,
      requirements: [],
      tags: [],
    };
    let sourceType = "pasted";
    let sourceId = payload.jobId || payload.applicationId || "chat";
    if (payload.jobId) {
      const catalogJob = await loadCatalogJobById(payload.jobId);
      if (catalogJob) {
        jobData = catalogJob;
        sourceType = "catalog";
        sourceId = String(catalogJob._id);
      }
    } else if (payload.applicationId) {
      const app = await applicationRepository.findOwnedById(payload.applicationId, userId);
      if (app) {
        jobData = {
          title: app.role,
          company: app.company,
          rawDescription: app.notes || `${app.role} at ${app.company}`,
          requirements: [],
          tags: [],
        };
        sourceType = "application";
        sourceId = String(app._id);
      }
    }
    const scored = await scoreResumeForJob({ resume, profile, job: jobData });
    let reportId = `match_${randomUUID()}`;
    if (isMongoReady()) {
      const contentHash = reportJobHash(jobData);
      const jobKey = `${sourceType}:${sourceId}:${contentHash}`;
      const deterministicResult = {
        match: scored.match,
        requirements: scored.requirements,
        atsReadiness: scored.atsReadiness,
        resumeChoices: [
          {
            id: String(resume._id),
            filename: resume.originalFilename || "Resume",
            createdAt: resume.createdAt,
            score: scored.match.score,
            isBest: true,
          },
        ],
      };
      const savedReport = await JobMatchReport.findOneAndUpdate(
        { userId, resumeId: resume._id, jobKey, scoreVersion: RESUME_MATCH_SCORE_VERSION },
        {
          $setOnInsert: {
            userId,
            resumeId: resume._id,
            resumeHash: resume.fileHash || "hash",
            jobKey,
            scoreVersion: RESUME_MATCH_SCORE_VERSION,
            job: {
              type: sourceType,
              catalogJobId: sourceType === "catalog" ? sourceId : "",
              applicationId: sourceType === "application" ? sourceId : "",
              title: jobData.title,
              company: jobData.company,
              description: String(jobData.rawDescription || "").slice(0, 5000),
              contentHash,
              requirements: jobData.requirements || [],
              tags: jobData.tags || [],
            },
            deterministicResult,
            ignoredKeywords: [],
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();
      if (savedReport?._id) reportId = String(savedReport._id);
    }

    executionResult = {
      actionType,
      status: "confirmed",
      message: `Resume Match report ready (${scored.match.score}% ${scored.match.band} match).`,
      resourceId: reportId,
      redirectUrl: payload.jobId
        ? `/app/resume-match?jobId=${payload.jobId}`
        : payload.applicationId
          ? `/app/resume-match?applicationId=${payload.applicationId}`
          : `/app/resume-match`,
      matchSummary: {
        reportId,
        score: scored.match.score,
        band: scored.match.band,
      },
    };
  } else {
    const err = new Error(`Unsupported action type: ${actionType}`);
    err.statusCode = 400;
    err.code = "UNSUPPORTED_ACTION_TYPE";
    throw err;
  }

  inMemoryConsumedActions.set(nonceKey, executionResult);
  inMemoryConsumedActions.set(idemKey, executionResult);

  const auditEntry = {
    userId,
    action: "CHAT_ACTION_CONFIRMED",
    ipAddress,
    userAgent,
    metadata: {
      actionType,
      nonce: envelope.nonce,
      idempotencyKey: cleanIdempotencyKey,
      resourceId: executionResult.resourceId,
      payload,
      result: executionResult,
    },
    createdAt: new Date(),
  };
  inMemoryAuditLogs.push(auditEntry);

  if (isMongoReady() && mongoose.isValidObjectId(userId)) {
    await AuditLog.create(auditEntry).catch((err) => {
      logger.warn({ err: err.message, userId, actionType }, "Failed to write chat action AuditLog");
    });
  }

  return { ...executionResult, idempotentReplay: false };
}

export async function listUserActionAuditLogs(userId) {
  const uid = String(userId || "");
  if (isMongoReady() && mongoose.isValidObjectId(uid)) {
    return AuditLog.find({ userId: uid, action: "CHAT_ACTION_CONFIRMED" })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
  }
  return inMemoryAuditLogs.filter((entry) => String(entry.userId) === uid);
}

export { confirmProposedAction as confirmChatAction };
