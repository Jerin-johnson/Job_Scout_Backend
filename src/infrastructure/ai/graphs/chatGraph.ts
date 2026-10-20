import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { env } from "../../../config/env.js";
import { getCheckpointer, toNamespacedThreadId } from "../checkpointer.js";
import { routeRequest } from "../router.js";
import type { RoutingDecision } from "../router.js";
import { invokeLLM } from "../llm.js";
import { quotaService } from "../../database/mongoose/services/quotaService.js";
import { assembleChatContext, CHAT_AGENT_PROMPT_VERSION } from "../chatContext.js";
import type { PageContext, HistoryMessage, AssembledChatContext } from "../chatContext.js";
import {
  createChatTools,
  TOOL_STATUS_LABELS,
  TOOL_SOURCE_LABELS,
  wrapUntrustedToolResult,
} from "../tools/chatTools.js";
import type { ContextUserConfig } from "../tools/chatTools.js";
import { logger } from "../../../shared/utils/logger.js";

export interface UserLike {
  _id?: unknown;
  id?: string;
  name?: string;
  email?: string;
  plan?: string;
  profileVersion?: number;
  [key: string]: unknown;
}

export interface ChatEntitlements {
  plan: string;
  toolsEnabled: boolean;
  maxToolCallsPerTurn: number;
  maxToolCallsDaily: number;
  toolCallsUsedToday: number;
  turnTokenBudget: number;
  maxOutputTokens: number;
  allowedModelTier: string;
  degraded: boolean;
  degradationReason: string | null;
  dailySpendUsd: number;
  dailyBudgetUsd: number;
}

export const MAX_TOOL_ITERATIONS = 4;
export const DEFAULT_TOOL_TIMEOUT_MS = 4000;

const INJECTION_PATTERNS = [
  /(?:ignore|forget)\s+(?:all\s+|any\s+|previous\s+|prior\s+|safety\s+)?(?:instructions|rules|system\s+prompt|guidelines)/i,
  /reveal\s+(?:your\s+|the\s+)?(?:system\s+prompt|developer\s+message|hidden\s+instructions)/i,
  /(?:print|output|show|dump|repeat)\s+(?:your\s+|the\s+)?(?:hidden\s+)?(?:system\s+(?:prompt|instructions)|initial\s+instructions|env|process\.env|api\s*key|jwt_access_secret)/i,
  /you\s+are\s+now\s+(?:dan|unrestricted|in\s+developer\s+mode)/i,
  /system\s*override\s*:/i,
];

export function isPromptInjectionAttempt(text = ""): boolean {
  const sample = String(text || "");
  return INJECTION_PATTERNS.some((pattern) => pattern.test(sample));
}

export function sanitizeAssistantResponse(text = ""): string {
  let clean = String(text || "");
  // Strip any accidental leakage of internal prompt version or raw delimiter tags
  clean = clean
    .replace(new RegExp(CHAT_AGENT_PROMPT_VERSION, "gi"), "JobScout Assistant")
    .replace(
      /<\/?(?:candidate_context|untrusted_page_context|untrusted_memory_context|untrusted_tool_result)[^>]*>/gi,
      "",
    )
    .trim();
  return clean;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = Object.assign(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`), {
        code: "TOOL_TIMEOUT",
      });
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface DeterministicToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface PlanDeterministicParams {
  prompt?: string;
  pageContext?: PageContext | null;
  decision?:
    (Partial<RoutingDecision> & { needsTools?: boolean; suggestedTools?: string[] }) | null;
}

/**
 * Deterministic tool planner used as a fallback or in mock/offline evaluation mode
 * so every tool-requiring intent executes the real LangGraph tool loop.
 */
export function planDeterministicToolCalls({
  prompt = "",
  pageContext = null,
  decision = {},
}: PlanDeterministicParams): DeterministicToolCall[] {
  const lower = String(prompt || "").toLowerCase();
  const calls: DeterministicToolCall[] = [];

  if (isPromptInjectionAttempt(prompt)) {
    return [];
  }

  // Cross-user explicit ID probes in prompt (e.g. "show application app_other_user" or "get job job_123")
  const explicitAppMatch = prompt.match(/\bapplication(?:\s+id)?\s+([a-zA-Z0-9_-]{4,64})\b/i);
  const explicitJobMatch = prompt.match(/\bjob(?:\s+id)?\s+([a-zA-Z0-9_-]{4,64})\b/i);
  const explicitInterviewMatch = prompt.match(
    /\binterview(?:\s+report)?(?:\s+id)?\s+([a-f0-9]{24})\b/i,
  );

  // Action proposals
  if (/\b(add|save|track)\b.*\b(job|role|position|tracker|application)\b/i.test(lower)) {
    const companyMatch = prompt.match(/\bat\s+([A-Z][A-Za-z0-9 .&-]{1,50})/);
    const roleMatch = prompt.match(
      /\b(?:track|add|save)\s+(?:the\s+)?([A-Za-z0-9 /-]{3,60}?)\s+(?:role|job|position)?\s*at\b/i,
    );
    calls.push({
      id: `call_propose_add_${Date.now()}`,
      name: "propose_add_job_to_tracker",
      args: {
        ...(pageContext?.type === "job" && pageContext?.id ? { jobId: pageContext.id } : {}),
        company: companyMatch ? companyMatch[1].trim() : "Target Company",
        role: roleMatch ? roleMatch[1].trim() : "Software Engineer",
        status: "saved",
        priority: "medium",
      },
    });
    return calls;
  }

  if (/\b(set|schedule|plan|add|create)\b.*\b(follow[- ]?up|reminder)\b/i.test(lower)) {
    const appId =
      (pageContext?.type === "application" && pageContext?.id) ||
      (explicitAppMatch ? explicitAppMatch[1] : "");
    if (appId) {
      calls.push({
        id: `call_propose_followup_${Date.now()}`,
        name: "propose_set_follow_up",
        args: { applicationId: appId, followUpInDays: 5, reminderEnabled: true },
      });
      return calls;
    }
    calls.push({
      id: `call_list_apps_followup_${Date.now()}`,
      name: "list_applications",
      args: { followUp: "overdue", limit: 5 },
    });
    return calls;
  }

  if (
    /\b(set|change|update|make|mark)\b.*\bpriority\b.*\b(high|medium|low)\b/i.test(lower) ||
    /\b(high|medium|low)\s+priority\b/i.test(lower)
  ) {
    const prioMatch = lower.match(/\b(high|medium|low)\b/);
    const priority = prioMatch ? prioMatch[1] : "high";
    const appId =
      (pageContext?.type === "application" && pageContext?.id) ||
      (explicitAppMatch ? explicitAppMatch[1] : "");
    if (appId) {
      calls.push({
        id: `call_propose_prio_${Date.now()}`,
        name: "propose_set_application_priority",
        args: { applicationId: appId, priority },
      });
      return calls;
    }
  }

  if (
    /\b(start|launch|begin|create|schedule)\b.*\b(mock\s+interview|practice\s+interview)\b/i.test(
      lower,
    )
  ) {
    const mode = /\btechnical\b/i.test(lower)
      ? "technical"
      : /\bfounder\b/i.test(lower)
        ? "founder"
        : /\bcase\b/i.test(lower)
          ? "aptitude_case"
          : "behavioral";
    calls.push({
      id: `call_propose_interview_${Date.now()}`,
      name: "propose_start_practice_interview",
      args: {
        role: "Software Engineer",
        level: /\bsenior\b/i.test(lower)
          ? "senior"
          : /\bfresher|junior|entry\b/i.test(lower)
            ? "fresher"
            : "mid",
        mode,
        durationMinutes: "15",
        ...(pageContext?.type === "job" && pageContext?.id ? { jobId: pageContext.id } : {}),
      },
    });
    return calls;
  }

  if (/\b(open|create|generate)\b.*\bresume\s+match\s+report\b/i.test(lower)) {
    const target: Record<string, unknown> | null =
      pageContext?.type === "job" && pageContext?.id
        ? { jobId: pageContext.id }
        : pageContext?.type === "application" && pageContext?.id
          ? { applicationId: pageContext.id }
          : explicitJobMatch
            ? { jobId: explicitJobMatch[1] }
            : null;
    if (target) {
      calls.push({
        id: `call_propose_rm_${Date.now()}`,
        name: "propose_open_resume_match",
        args: target,
      });
      return calls;
    }
  }

  // Read-only tools
  if (/\b(match|fit|missing\s+skills|gap|tailor|compare\s+my\s+resume|ats)\b/i.test(lower)) {
    if (pageContext?.type === "job" && pageContext?.id) {
      calls.push({
        id: `call_rm_job_${Date.now()}`,
        name: "run_resume_match",
        args: { jobId: pageContext.id },
      });
      calls.push({
        id: `call_get_job_${Date.now()}`,
        name: "get_job",
        args: { jobId: pageContext.id },
      });
      return calls;
    }
    if (pageContext?.type === "application" && pageContext?.id) {
      calls.push({
        id: `call_rm_app_${Date.now()}`,
        name: "run_resume_match",
        args: { applicationId: pageContext.id },
      });
      return calls;
    }
    if (explicitJobMatch) {
      calls.push({
        id: `call_rm_expjob_${Date.now()}`,
        name: "run_resume_match",
        args: { jobId: explicitJobMatch[1] },
      });
      return calls;
    }
    calls.push({
      id: `call_resume_facts_${Date.now()}`,
      name: "get_resume_facts",
      args: {},
    });
  }

  if (pageContext?.type === "job" && pageContext?.id && calls.length === 0) {
    calls.push({
      id: `call_page_job_${Date.now()}`,
      name: "get_job",
      args: { jobId: pageContext.id },
    });
  }

  if (pageContext?.type === "application" && pageContext?.id && calls.length === 0) {
    calls.push({
      id: `call_page_app_${Date.now()}`,
      name: "get_application",
      args: { applicationId: pageContext.id },
    });
  }

  if (explicitAppMatch && calls.length === 0) {
    calls.push({
      id: `call_exp_app_${Date.now()}`,
      name: "get_application",
      args: { applicationId: explicitAppMatch[1] },
    });
  }

  if (explicitJobMatch && calls.length === 0) {
    calls.push({
      id: `call_exp_job_${Date.now()}`,
      name: "get_job",
      args: { jobId: explicitJobMatch[1] },
    });
  }

  if (explicitInterviewMatch && calls.length === 0) {
    calls.push({
      id: `call_exp_int_${Date.now()}`,
      name: "get_interview_report",
      args: { interviewId: explicitInterviewMatch[1] },
    });
  }

  if (/\b(applications?|tracker|kanban|pipeline|applied|overdue|follow[- ]?ups?)\b/i.test(lower)) {
    const followUp = /\boverdue\b/i.test(lower)
      ? "overdue"
      : /\bdue\b/i.test(lower)
        ? "due-soon"
        : "";
    calls.push({
      id: `call_list_apps_${Date.now()}`,
      name: "list_applications",
      args: { followUp, limit: 8 },
    });
  }

  if (
    /\b(interview\s+score|mock\s+interview|interview\s+report|interview\s+feedback|star\s+method|weakness|focus\s+area)\b/i.test(
      lower,
    )
  ) {
    calls.push({
      id: `call_int_reports_${Date.now()}`,
      name: "get_interview_reports",
      args: { limit: 5 },
    });
  }

  if (
    /\b(find|search|recommend|show|browse)\b.*\b(jobs?|roles?|openings?|positions?)\b/i.test(lower)
  ) {
    const remoteType = /\bremote\b/i.test(lower)
      ? "remote"
      : /\bhybrid\b/i.test(lower)
        ? "hybrid"
        : /\bonsite\b/i.test(lower)
          ? "onsite"
          : "";
    calls.push({
      id: `call_search_jobs_${Date.now()}`,
      name: "search_jobs",
      args: { query: "", remoteType, limit: 5 },
    });
  }

  if (
    /\b(career\s+profile|completeness|missing\s+profile|profile\s+status|work\s+authorization)\b/i.test(
      lower,
    )
  ) {
    calls.push({
      id: `call_cp_status_${Date.now()}`,
      name: "get_career_profile_status",
      args: {},
    });
  }

  if (
    /\b(resume|bullet|achievement|experience|skills|education)\b/i.test(lower) &&
    calls.length === 0
  ) {
    calls.push({
      id: `call_res_facts_${Date.now()}`,
      name: "get_resume_facts",
      args: {},
    });
  }

  if (/\b(remember|memory|memories|preferences?|saved\s+goals?)\b/i.test(lower)) {
    calls.push({
      id: `call_memories_${Date.now()}`,
      name: "search_memories",
      args: { query: prompt.slice(0, 120) },
    });
  }

  if (calls.length === 0 && decision?.needsTools) {
    for (const suggested of (decision.suggestedTools || []).slice(0, 2)) {
      if (suggested === "get_profile_summary") {
        calls.push({ id: `call_prof_${Date.now()}`, name: "get_profile_summary", args: {} });
      } else if (suggested === "list_applications") {
        calls.push({
          id: `call_apps_${Date.now()}`,
          name: "list_applications",
          args: { limit: 8 },
        });
      } else if (suggested === "get_resume_facts") {
        calls.push({ id: `call_facts_${Date.now()}`, name: "get_resume_facts", args: {} });
      } else if (suggested === "get_interview_reports") {
        calls.push({
          id: `call_ints_${Date.now()}`,
          name: "get_interview_reports",
          args: { limit: 5 },
        });
      } else if (suggested === "search_jobs") {
        calls.push({ id: `call_jobs_${Date.now()}`, name: "search_jobs", args: { limit: 5 } });
      }
    }
  }

  return calls;
}

export interface CandidateCardLike {
  currentRole?: string;
  targetRoles?: string[];
  location?: string;
  skills?: string[];
  activeApplications?: number;
  followUpsDue?: number;
  [key: string]: unknown;
}

export interface ResolvedPageContextLike {
  title?: string;
  role?: string;
  company?: string;
  [key: string]: unknown;
}

export interface SynthesizeGroundedParams {
  prompt?: string;
  candidateCard?: CandidateCardLike;
  resolvedPageContext?: ResolvedPageContextLike | null;
  relevantMemories?: Array<{ content?: string; [key: string]: unknown }>;
  toolResults?: Array<{ name: string; content?: string }>;
  proposedActions?: Array<{ title?: string; description?: string; [key: string]: unknown }>;
}

/**
 * Synthesizes a grounded response from the assembled context and executed tool results
 * when running in mock/offline evaluation mode or when a provider fallback is triggered.
 */
export function synthesizeGroundedResponse({
  prompt = "",
  candidateCard = {},
  resolvedPageContext = null,
  relevantMemories = [],
  toolResults = [],
  proposedActions = [],
}: SynthesizeGroundedParams): string {
  if (isPromptInjectionAttempt(prompt)) {
    return "I can only assist with your job search, resume, applications, and interview preparation. I cannot override safety instructions, reveal internal system prompts, or expose configuration secrets.";
  }

  const parts: string[] = [];
  const parsedToolPayloads: Array<{ name: string; data?: Record<string, unknown>; raw?: string }> =
    [];
  for (const item of toolResults) {
    const raw = String(item.content || "");
    const match = raw.match(
      /<untrusted_tool_result[^>]*>\s*([\s\S]*?)\s*<\/untrusted_tool_result>/i,
    );
    if (match) {
      try {
        parsedToolPayloads.push({
          name: item.name,
          data: JSON.parse(match[1].replace(/\.\.\.\[truncated\]$/, "")),
        });
      } catch {
        parsedToolPayloads.push({ name: item.name, raw: match[1] });
      }
    }
  }

  // Check if any tool returned NOT_FOUND (e.g. cross-user ID probe)
  const notFoundTools = parsedToolPayloads.filter((t) => t.data?.error === "NOT_FOUND");
  if (notFoundTools.length > 0 && parsedToolPayloads.length === notFoundTools.length) {
    return "I could not find that record in your account. Please verify the item exists in your workspace and belongs to your profile.";
  }

  if (proposedActions.length > 0) {
    const action = proposedActions[0];
    parts.push(
      `I have prepared a confirmation card for **${action.title || "Proposed Action"}** (${action.description || ""}). Please review the details on the card below and click **Confirm** to apply this change.`,
    );
  }

  for (const toolItem of parsedToolPayloads) {
    const { name, data } = toolItem;
    if (!data || data.error) continue;

    if (name === "run_resume_match") {
      const mustHaveMatched = (data.mustHaveMatched as string[]) || [];
      const mustHaveMissing = (data.mustHaveMissing as string[]) || [];
      parts.push(
        `### Resume Match: ${data.jobTitle} at ${data.company}\n- **Overall Match Score**: **${data.score}%** (${data.band} fit)\n- **Matched Must-Haves**: ${mustHaveMatched.join(", ") || "None detected yet"}\n- **Missing Must-Haves**: ${mustHaveMissing.join(", ") || "None"}\n- **ATS Readiness**: ${data.atsReadinessScore ?? "N/A"}%`,
      );
    } else if (name === "get_job") {
      const requirements = (data.requirements as string[]) || [];
      parts.push(
        `### Job Overview: ${data.title} at ${data.company}\n- **Location**: ${data.location || "Unspecified"} (${data.remoteType})\n- **Profile Fit**: ${data.score !== null ? `${data.score}% (${data.scoreBand})` : "Upload resume to score"}\n- **Eligibility**: ${data.eligibility}\n- **Key Requirements**: ${requirements.slice(0, 6).join(", ") || "See job description"}`,
      );
    } else if (name === "search_jobs") {
      const jobs =
        (data.jobs as Array<{
          title?: string;
          company?: string;
          location?: string;
          remoteType?: string;
          score?: number | null;
        }>) || [];
      if (jobs.length === 0) {
        parts.push(
          "I searched the active job catalog and found **0 matching jobs** for those filters right now. Consider broadening your location or keyword filters.",
        );
      } else {
        const list = jobs
          .map(
            (j) =>
              `- **${j.title}** at **${j.company}** (${j.location || j.remoteType}) — Match: ${j.score !== null ? `${j.score}%` : "N/A"}`,
          )
          .join("\n");
        parts.push(`### Matching Jobs (${jobs.length} found)\n${list}`);
      }
    } else if (name === "list_applications") {
      const apps =
        (data.applications as Array<{
          role?: string;
          company?: string;
          status?: string;
          priority?: string;
          nextFollowUpAt?: string;
        }>) || [];
      const stats = (data.stats as { totalActive?: number; followUpsDue?: number }) || {};
      if (apps.length === 0) {
        parts.push(
          `You currently have **${stats.totalActive || 0} active applications** matching that filter.`,
        );
      } else {
        const list = apps
          .slice(0, 5)
          .map(
            (a) =>
              `- **${a.role}** at **${a.company}** — Stage: \`${a.status}\`, Priority: \`${a.priority}\`${a.nextFollowUpAt ? `, Follow-up: ${String(a.nextFollowUpAt).slice(0, 10)}` : ""}`,
          )
          .join("\n");
        parts.push(
          `### Application Tracker Summary (${stats.totalActive || apps.length} active, ${stats.followUpsDue || 0} follow-ups due)\n${list}`,
        );
      }
    } else if (name === "get_application") {
      parts.push(
        `### Application Details: ${data.role} at ${data.company}\n- **Stage**: \`${data.status}\` | **Priority**: \`${data.priority}\`\n- **Next Follow-up**: ${data.nextFollowUpAt ? String(data.nextFollowUpAt).slice(0, 10) : "Not scheduled"}\n${data.notes ? `- **Notes**: ${data.notes}` : ""}`,
      );
    } else if (name === "get_interview_reports") {
      const sessions =
        (data.sessions as Array<{
          role?: string;
          mode?: string;
          level?: string;
          overallScore?: number | null;
          strengths?: string[];
          focusAreas?: string[];
        }>) || [];
      if (sessions.length === 0) {
        parts.push(
          "You don't have any completed mock interview reports yet. We can start a 15-minute practice interview whenever you're ready.",
        );
      } else {
        const latest = sessions[0];
        parts.push(
          `### Mock Interview Summary\n- **Latest Session**: ${latest.role} (${latest.mode}, ${latest.level}) — Score: **${latest.overallScore ?? "In progress"}/100**\n- **Strengths**: ${(latest.strengths || []).join(", ") || "N/A"}\n- **Focus Areas**: ${(latest.focusAreas || []).join(", ") || "N/A"}`,
        );
      }
    } else if (name === "get_resume_facts") {
      const rawRoles = (data.roles as Array<{ title?: string; company?: string }>) || [];
      const roles = rawRoles.map((r) => `${r.title} at ${r.company}`).filter(Boolean);
      const skills = ((data.skills as string[]) || []).slice(0, 10);
      parts.push(
        `### Grounded Resume Snapshot\n- **Roles**: ${roles.join("; ") || "No roles parsed yet"}\n- **Verified Skills**: ${skills.join(", ") || "No skills parsed yet"}`,
      );
    } else if (name === "get_career_profile_status") {
      const targetRoles = (data.targetRoles as string[]) || [];
      const preferredLocations = (data.preferredLocations as string[]) || [];
      const missingFields = (data.missingFields as string[]) || [];
      parts.push(
        `### Career Profile Status (${data.completenessPercent}% complete)\n- **Target Roles**: ${targetRoles.join(", ") || "Not set"}\n- **Preferred Locations**: ${preferredLocations.join(", ") || "Not set"}\n- **Work Mode**: ${data.workMode}\n- **Missing Fields**: ${missingFields.join(", ") || "None — profile is complete!"}`,
      );
    } else if (name === "get_profile_summary") {
      const p = (data.profile as CandidateCardLike) || {};
      parts.push(
        `### Candidate Snapshot\n- **Current Role**: ${p.currentRole || "Not specified"}\n- **Target Roles**: ${(p.targetRoles || []).join(", ") || "Not set"}\n- **Top Skills**: ${(p.skills || []).join(", ") || "Not set"}\n- **Location**: ${p.location || "Not set"}`,
      );
    } else if (name === "search_memories") {
      const mems = (data.memories as Array<{ content?: string }>) || [];
      if (mems.length > 0) {
        parts.push(`### Saved Preferences\n${mems.map((m) => `- ${m.content}`).join("\n")}`);
      }
    }
  }

  if (parts.length === 0) {
    const roleInfo = candidateCard.currentRole
      ? `Based on your background as **${candidateCard.currentRole}**`
      : "Based on your JobScout profile";
    const targetInfo = candidateCard.targetRoles?.length
      ? ` targeting **${candidateCard.targetRoles.join(", ")}**`
      : "";
    const locInfo = candidateCard.location ? ` in **${candidateCard.location}**` : "";
    const pageInfo = resolvedPageContext
      ? `\n\n regarding **${resolvedPageContext.title || resolvedPageContext.role}** at **${resolvedPageContext.company}**:`
      : ":";
    const memInfo =
      relevantMemories.length > 0 ? `\n- **Saved Preference**: ${relevantMemories[0].content}` : "";

    parts.push(
      `${roleInfo}${targetInfo}${locInfo}${pageInfo}\n- **Key Skills**: ${(candidateCard.skills || []).slice(0, 6).join(", ") || "Add skills in your profile or resume"}\n- **Active Applications**: ${candidateCard.activeApplications ?? 0} (${candidateCard.followUpsDue ?? 0} follow-ups due)${memInfo}\n\nLet me know if you'd like me to run a resume match, check your application tracker, search open roles, or set up a practice interview.`,
    );
  }

  return sanitizeAssistantResponse(parts.join("\n\n"));
}

export const ChatStateAnnotation = Annotation.Root({
  userId: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  threadId: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  prompt: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  pageContext: Annotation<PageContext | null>({ reducer: (_, next) => next, default: () => null }),
  rollingSummary: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  historyMessages: Annotation<HistoryMessage[]>({ reducer: (_, next) => next, default: () => [] }),
  decision: Annotation<RoutingDecision | null>({ reducer: (_, next) => next, default: () => null }),
  entitlements: Annotation<ChatEntitlements | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  candidateCard: Annotation<CandidateCardLike>({ reducer: (_, next) => next, default: () => ({}) }),
  resolvedPageContext: Annotation<ResolvedPageContextLike | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  relevantMemories: Annotation<Array<{ content?: string; [key: string]: unknown }>>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  telemetry: Annotation<Record<string, unknown>>({
    reducer: (_, next) => next,
    default: () => ({}),
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => (Array.isArray(next) ? next : [...(prev || []), next]),
    default: () => [],
  }),
  toolCallsExecuted: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  toolIterations: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  toolResults: Annotation<Array<{ name: string; content?: string }>>({
    reducer: (prev, next) => [...(prev || []), ...(Array.isArray(next) ? next : [next])],
    default: () => [],
  }),
  sourcesUsed: Annotation<string[]>({
    reducer: (prev, next) => [
      ...new Set([...(prev || []), ...(Array.isArray(next) ? next : [next])]),
    ],
    default: () => [],
  }),
  proposedActions: Annotation<Array<Record<string, unknown>>>({
    reducer: (prev, next) => [...(prev || []), ...(Array.isArray(next) ? next : [next])],
    default: () => [],
  }),
  responseText: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  injectionBlocked: Annotation<boolean>({ reducer: (_, next) => next, default: () => false }),
});

export interface BuildChatStateGraphOptions {
  checkpointer?: BaseCheckpointSaver | null;
}

interface NodeConfig {
  configurable?: {
    user?: UserLike;
    userId?: string;
    onToolStatus?: (status: {
      toolName: string;
      status: "running" | "completed" | "error";
      message: string;
    }) => void;
    mockResponder?: unknown;
    deterministicMock?: boolean;
    toolTimeoutMs?: number;
    [key: string]: unknown;
  };
}

/**
 * Builds and compiles the LangGraph StateGraph for the Production Chat Agent.
 */
export function buildChatStateGraph({ checkpointer = null }: BuildChatStateGraphOptions = {}) {
  const workflow = new StateGraph(ChatStateAnnotation)
    .addNode("classifyAndRoute", async (state, config?: NodeConfig) => {
      const user = config?.configurable?.user || {
        _id: state.userId,
        id: state.userId,
        plan: "free",
      };
      const userId = String(state.userId || user._id || user.id || "");
      const [decision, entitlements] = await Promise.all([
        routeRequest({ prompt: state.prompt, user, contextVersion: user.profileVersion || 1 }),
        quotaService.getChatEntitlements(user),
      ]);

      const assembled: AssembledChatContext = await assembleChatContext({
        user,
        prompt: state.prompt,
        pageContext: state.pageContext,
        rollingSummary: state.rollingSummary,
        historyMessages: state.historyMessages,
        needsMemory: decision.needsMemory !== false,
        turnTokenBudget: entitlements.turnTokenBudget,
      });

      const injectionBlocked = isPromptInjectionAttempt(state.prompt);
      const lcMessages: BaseMessage[] = assembled.messages.map(
        (m: { role: string; content: string }) =>
          m.role === "system"
            ? new SystemMessage(m.content)
            : m.role === "assistant"
              ? new AIMessage(m.content)
              : new HumanMessage(m.content),
      );

      // Apply budget-degradation or plan tier override
      const requestedModelTier = Number(decision.tier) === 2 ? "strong" : "small";
      const effectiveModelTier =
        entitlements.allowedModelTier === "small" && requestedModelTier === "strong"
          ? "small"
          : requestedModelTier;

      return {
        userId,
        decision: { ...decision, modelTier: effectiveModelTier },
        entitlements,
        candidateCard: assembled.candidateSnapshot?.card || {},
        resolvedPageContext: assembled.resolvedPageContext,
        relevantMemories: assembled.relevantMemories || [],
        telemetry: assembled.telemetry,
        messages: lcMessages,
        sourcesUsed: assembled.initialSources || [],
        injectionBlocked,
      };
    })
    .addNode("agentNode", async (state, config?: NodeConfig) => {
      if (state.injectionBlocked) {
        const safeReply =
          "I can only assist with your job search, resume, applications, and interview preparation. I cannot override safety instructions, reveal internal system prompts, or expose configuration secrets.";
        return {
          messages: [...state.messages, new AIMessage(safeReply)],
          responseText: safeReply,
        };
      }

      const user = config?.configurable?.user || {
        _id: state.userId,
        id: state.userId,
        plan: "free",
      };
      const entitlements = state.entitlements || (await quotaService.getChatEntitlements(user));
      const canCallTools =
        Boolean(
          entitlements.toolsEnabled ||
          (!entitlements.degraded && (entitlements.maxToolCallsPerTurn || 0) > 0),
        ) &&
        state.toolIterations < MAX_TOOL_ITERATIONS &&
        state.toolCallsExecuted < (entitlements.maxToolCallsPerTurn || 2);

      const tools = canCallTools ? createChatTools(config as unknown as ContextUserConfig) : [];
      const mockResponder = config?.configurable?.mockResponder;
      const deterministicMock = Boolean(config?.configurable?.deterministicMock);

      const useDeterministicPlanner =
        deterministicMock ||
        Boolean(mockResponder) ||
        Boolean(
          env.AI_ALLOW_MOCKS && !env.GEMINI_API_KEY && !env.GROQ_API_KEY && !env.ANTHROPIC_API_KEY,
        );

      if (useDeterministicPlanner && !mockResponder) {
        if (canCallTools && state.toolIterations === 0) {
          const planned = planDeterministicToolCalls({
            prompt: state.prompt,
            pageContext: state.pageContext,
            decision: state.decision,
          }).slice(0, entitlements.maxToolCallsPerTurn);
          if (planned.length > 0) {
            return {
              messages: [...state.messages, new AIMessage({ content: "", tool_calls: planned })],
            };
          }
        }
        const synthesized = synthesizeGroundedResponse({
          prompt: state.prompt,
          candidateCard: state.candidateCard,
          resolvedPageContext: state.resolvedPageContext,
          relevantMemories: state.relevantMemories,
          toolResults: state.toolResults,
          proposedActions: state.proposedActions,
        });
        return {
          messages: [...state.messages, new AIMessage(synthesized)],
          responseText: synthesized,
        };
      }

      try {
        const promptPayload = state.messages.map((msg) => {
          const type = (msg as { _getType?: () => string; role?: string })._getType
            ? (msg as { _getType: () => string })._getType()
            : (msg as { role?: string }).role;
          if (type === "system") return { role: "system", content: String(msg.content) };
          if (type === "tool") {
            const tm = msg as ToolMessage;
            return {
              role: "tool",
              content: String(msg.content),
              tool_call_id: tm.tool_call_id,
              name: tm.name,
            };
          }
          if (type === "ai" || type === "assistant") {
            const aim = msg as AIMessage;
            return {
              role: "assistant",
              content: String(msg.content || ""),
              ...(aim.tool_calls?.length ? { tool_calls: aim.tool_calls } : {}),
            };
          }
          return { role: "user", content: String(msg.content) };
        });

        const decisionTier = (state.decision as { modelTier?: "small" | "strong"; tier?: unknown })
          ?.modelTier;
        const fallbackTier =
          (state.decision as { tier?: unknown })?.tier === 2 ? "strong" : "small";
        const llmOut = await invokeLLM<unknown>({
          user,
          tier: decisionTier || fallbackTier,
          feature: "chat",
          prompt: promptPayload,
          tools: canCallTools ? tools : undefined,
          mockResponder: mockResponder as Parameters<typeof invokeLLM>[0]["mockResponder"],
          maxTokens: 1000,
        });

        const llmObj = llmOut as { content?: string; tool_calls?: unknown[] } | null;

        if (
          llmObj &&
          typeof llmObj === "object" &&
          Array.isArray(llmObj.tool_calls) &&
          llmObj.tool_calls.length > 0 &&
          canCallTools
        ) {
          return {
            messages: [
              ...state.messages,
              new AIMessage({
                content: String(llmObj.content || ""),
                tool_calls: llmObj.tool_calls as never[],
              }),
            ],
          };
        }

        // If the first iteration needed tools or had explicit pageContext/actions, and the LLM didn't emit tool_calls, run deterministic fallback
        if (canCallTools && state.toolIterations === 0) {
          const fallbackCalls = planDeterministicToolCalls({
            prompt: state.prompt,
            pageContext: state.pageContext,
            decision: state.decision,
          }).slice(0, entitlements.maxToolCallsPerTurn);
          if (fallbackCalls.length > 0) {
            return {
              messages: [
                ...state.messages,
                new AIMessage({ content: "", tool_calls: fallbackCalls }),
              ],
            };
          }
        }

        const textContent = typeof llmOut === "string" ? llmOut : String(llmObj?.content || "");
        const finalContent =
          textContent.trim() ||
          synthesizeGroundedResponse({
            prompt: state.prompt,
            candidateCard: state.candidateCard,
            resolvedPageContext: state.resolvedPageContext,
            relevantMemories: state.relevantMemories,
            toolResults: state.toolResults,
            proposedActions: state.proposedActions,
          });

        return {
          messages: [...state.messages, new AIMessage(finalContent)],
          responseText: finalContent,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err: msg, userId: state.userId },
          "Agent LLM call failed; falling back to grounded synthesis",
        );
        if (canCallTools && state.toolIterations === 0) {
          const planned = planDeterministicToolCalls({
            prompt: state.prompt,
            pageContext: state.pageContext,
            decision: state.decision,
          }).slice(0, entitlements.maxToolCallsPerTurn);
          if (planned.length > 0) {
            return {
              messages: [...state.messages, new AIMessage({ content: "", tool_calls: planned })],
            };
          }
        }
        const fallbackText = synthesizeGroundedResponse({
          prompt: state.prompt,
          candidateCard: state.candidateCard,
          resolvedPageContext: state.resolvedPageContext,
          relevantMemories: state.relevantMemories,
          toolResults: state.toolResults,
          proposedActions: state.proposedActions,
        });
        return {
          messages: [...state.messages, new AIMessage(fallbackText)],
          responseText: fallbackText,
        };
      }
    })
    .addNode("toolExecutorNode", async (state, config?: NodeConfig) => {
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage | undefined;
      const requestedCalls = Array.isArray(lastMessage?.tool_calls) ? lastMessage.tool_calls : [];
      const user = config?.configurable?.user || {
        _id: state.userId,
        id: state.userId,
        plan: "free",
      };
      const entitlements = state.entitlements || (await quotaService.getChatEntitlements(user));
      const toolCallsRemaining = Math.max(
        0,
        (entitlements.maxToolCallsDaily || 25) - (entitlements.toolCallsUsedToday || 0),
      );
      const remainingBudget = Math.max(
        0,
        Math.min(
          MAX_TOOL_ITERATIONS - state.toolCallsExecuted,
          (entitlements.maxToolCallsPerTurn || 2) - state.toolCallsExecuted,
          toolCallsRemaining,
        ),
      );
      const callsToRun = requestedCalls.slice(0, remainingBudget);
      const onToolStatus = config?.configurable?.onToolStatus;
      const newSources: string[] = [];
      const newProposedActions: Array<Record<string, unknown>> = [];

      const toolConfig: ContextUserConfig = {
        configurable: {
          ...config?.configurable,
          user,
          userId: state.userId,
          onToolComplete: (payload: unknown) => {
            const m = payload as
              { sourceLabel?: string; proposedAction?: Record<string, unknown> } | undefined;
            if (m?.sourceLabel) newSources.push(m.sourceLabel);
            if (m?.proposedAction) newProposedActions.push(m.proposedAction);
          },
        },
      };

      const tools = createChatTools(toolConfig);
      const toolMap = new Map(tools.map((t) => [t.name, t]));
      const timeoutMs = config?.configurable?.toolTimeoutMs || DEFAULT_TOOL_TIMEOUT_MS;

      const results = await Promise.all(
        callsToRun.map(async (call, idx) => {
          const callId = call.id || `call_${state.toolIterations}_${idx}`;
          const toolName = call.name;
          const statusLabel =
            (TOOL_STATUS_LABELS as Record<string, string>)[toolName] || `Running ${toolName}...`;
          if (onToolStatus) {
            onToolStatus({
              toolName,
              status: "running",
              message: statusLabel,
            });
          }

          const toolInstance = toolMap.get(toolName);
          if (!toolInstance) {
            const unknownOutput = wrapUntrustedToolResult(toolName, {
              error: "UNKNOWN_TOOL",
              message: `Tool ${toolName} is not available.`,
            });
            return {
              callId,
              toolName,
              content: unknownOutput,
            };
          }

          try {
            // Increment daily chat_tool counter
            await quotaService
              .incrementQuota(
                state.userId,
                "chat_tool",
                `${state.threadId}:${callId}`,
                (user.plan as "free") || "free",
              )
              .catch(() => {});

            const parsedArgs = toolInstance.schema.parse(call.args || {});
            const invokable = toolInstance as unknown as {
              invoke: (args: unknown, conf?: unknown) => Promise<string>;
            };
            const output = await withTimeout<string>(
              invokable.invoke(parsedArgs, toolConfig),
              timeoutMs,
              toolName,
            );
            const sourceLabel = (TOOL_SOURCE_LABELS as Record<string, string>)[toolName];
            if (sourceLabel) {
              newSources.push(sourceLabel);
            }
            if (onToolStatus) {
              onToolStatus({
                toolName,
                status: "completed",
                message: statusLabel.replace(/\.\.\.$/, ""),
              });
            }
            return {
              callId,
              toolName,
              content: output,
            };
          } catch (err: unknown) {
            const e = err as { code?: string; message?: string };
            logger.warn(
              { err: e.message || String(err), toolName, userId: state.userId },
              "Chat tool execution failed or timed out",
            );
            const errorPayload = wrapUntrustedToolResult(toolName, {
              error: e.code || "TOOL_EXECUTION_ERROR",
              message:
                e.code === "TOOL_TIMEOUT"
                  ? `Tool ${toolName} timed out and was skipped.`
                  : "Tool execution encountered an error.",
            });
            if (onToolStatus) {
              onToolStatus({
                toolName,
                status: "error",
                message: `Skipped ${toolName}`,
              });
            }
            return {
              callId,
              toolName,
              content: errorPayload,
            };
          }
        }),
      );

      const toolMessages = results.map(
        (r) =>
          new ToolMessage({
            content: r.content,
            tool_call_id: r.callId,
            name: r.toolName,
          }),
      );

      return {
        messages: [...state.messages, ...toolMessages],
        toolCallsExecuted: state.toolCallsExecuted + callsToRun.length,
        toolIterations: state.toolIterations + 1,
        toolResults: results.map((r) => ({ name: r.toolName, content: r.content })),
        sourcesUsed: newSources,
        proposedActions: newProposedActions,
      };
    })
    .addNode("guardrailAndRespond", async (state) => {
      const cleaned = sanitizeAssistantResponse(
        state.responseText ||
          synthesizeGroundedResponse({
            prompt: state.prompt,
            candidateCard: state.candidateCard,
            resolvedPageContext: state.resolvedPageContext,
            relevantMemories: state.relevantMemories,
            toolResults: state.toolResults,
            proposedActions: state.proposedActions,
          }),
      );
      return {
        responseText: cleaned,
      };
    })
    .addEdge(START, "classifyAndRoute")
    .addEdge("classifyAndRoute", "agentNode")
    .addConditionalEdges("agentNode", (state) => {
      if (state.injectionBlocked) return "guardrailAndRespond";
      const lastMsg = state.messages[state.messages.length - 1] as AIMessage | undefined;
      const hasToolCalls = Array.isArray(lastMsg?.tool_calls) && lastMsg.tool_calls.length > 0;
      const maxCalls = state.entitlements?.maxToolCallsPerTurn ?? 2;
      if (
        hasToolCalls &&
        state.toolIterations < MAX_TOOL_ITERATIONS &&
        state.toolCallsExecuted < maxCalls
      ) {
        return "toolExecutorNode";
      }
      return "guardrailAndRespond";
    })
    .addEdge("toolExecutorNode", "agentNode")
    .addEdge("guardrailAndRespond", END);

  return workflow.compile({
    checkpointer: checkpointer || undefined,
  });
}

export interface RunChatAgentTurnParams {
  user: UserLike;
  threadId?: string;
  prompt: string;
  pageContext?: PageContext | null;
  rollingSummary?: string;
  historyMessages?: HistoryMessage[];
  onToolStatus?:
    | ((status: {
        toolName: string;
        status: "running" | "completed" | "error";
        message: string;
      }) => void)
    | null;
  mockResponder?: unknown;
  deterministicMock?: boolean;
  toolTimeoutMs?: number;
}

export interface ChatAgentTurnResult {
  responseText: string;
  decision: RoutingDecision | null;
  entitlements: ChatEntitlements | null;
  sourcesUsed: string[];
  proposedActions: Array<Record<string, unknown>>;
  toolCallsExecuted: number;
  toolIterations: number;
  telemetry: Record<string, unknown>;
  injectionBlocked: boolean;
}

/**
 * Runs a single turn through the compiled LangGraph chat agent with user-namespaced checkpointing.
 */
export async function runChatAgentTurn({
  user,
  threadId = "default",
  prompt,
  pageContext = null,
  rollingSummary = "",
  historyMessages = [],
  onToolStatus = null,
  mockResponder = null,
  deterministicMock = false,
  toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
}: RunChatAgentTurnParams): Promise<ChatAgentTurnResult> {
  const userId = (user?._id || user?.id)?.toString();
  if (!userId) throw new Error("Authenticated user is required to run chat agent.");

  let checkpointer: BaseCheckpointSaver | null = null;
  try {
    checkpointer = getCheckpointer() as unknown as BaseCheckpointSaver;
  } catch {
    checkpointer = null;
  }

  const graph = buildChatStateGraph({ checkpointer });
  const checkpointThreadId = toNamespacedThreadId(userId, threadId);

  const result = await graph.invoke(
    {
      userId,
      threadId,
      prompt,
      pageContext,
      rollingSummary,
      historyMessages,
      toolCallsExecuted: 0,
      toolIterations: 0,
      toolResults: [],
      sourcesUsed: [],
      proposedActions: [],
      responseText: "",
      injectionBlocked: false,
    },
    {
      configurable: {
        thread_id: checkpointThreadId,
        user,
        userId,
        onToolStatus: onToolStatus || undefined,
        mockResponder,
        deterministicMock,
        toolTimeoutMs,
      },
    },
  );

  return {
    responseText: result.responseText,
    decision: result.decision,
    entitlements: result.entitlements,
    sourcesUsed: result.sourcesUsed || [],
    proposedActions: result.proposedActions || [],
    toolCallsExecuted: result.toolCallsExecuted || 0,
    toolIterations: result.toolIterations || 0,
    telemetry: result.telemetry || {},
    injectionBlocked: Boolean(result.injectionBlocked),
  };
}
