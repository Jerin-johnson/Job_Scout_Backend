import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { env } from "../../config/env.js";
import { getCheckpointer, toNamespacedThreadId } from "../checkpointer.js";
import { routeRequest } from "../router.js";
import { invokeLLM } from "../llm.js";
import { quotaService } from "../../services/quotaService.js";
import { assembleChatContext, CHAT_AGENT_PROMPT_VERSION } from "../chatContext.js";
import {
  createChatTools,
  TOOL_STATUS_LABELS,
  TOOL_SOURCE_LABELS,
  wrapUntrustedToolResult,
} from "../tools/chatTools.js";
import { logger } from "../../shared/utils/logger.js";

export const MAX_TOOL_ITERATIONS = 4;
export const DEFAULT_TOOL_TIMEOUT_MS = 4000;

const INJECTION_PATTERNS = [
  /(?:ignore|forget)\s+(?:all\s+|any\s+|previous\s+|prior\s+|safety\s+)?(?:instructions|rules|system\s+prompt|guidelines)/i,
  /reveal\s+(?:your\s+|the\s+)?(?:system\s+prompt|developer\s+message|hidden\s+instructions)/i,
  /(?:print|output|show|dump|repeat)\s+(?:your\s+|the\s+)?(?:hidden\s+)?(?:system\s+(?:prompt|instructions)|initial\s+instructions|env|process\.env|api\s*key|jwt_access_secret)/i,

  /you\s+are\s+now\s+(?:dan|unrestricted|in\s+developer\s+mode)/i,
  /system\s*override\s*:/i,
];

export function isPromptInjectionAttempt(text = "") {
  const sample = String(text || "");
  return INJECTION_PATTERNS.some((pattern) => pattern.test(sample));
}

export function sanitizeAssistantResponse(text = "") {
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

function withTimeout(promise, timeoutMs, toolName) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`);
      err.code = "TOOL_TIMEOUT";
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Deterministic tool planner used as a fallback or in mock/offline evaluation mode
 * so every tool-requiring intent executes the real LangGraph tool loop.
 */
export function planDeterministicToolCalls({ prompt = "", pageContext = null, decision = {} }) {
  const lower = String(prompt || "").toLowerCase();
  const calls = [];

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
    const target =
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
}) {
  if (isPromptInjectionAttempt(prompt)) {
    return "I can only assist with your job search, resume, applications, and interview preparation. I cannot override safety instructions, reveal internal system prompts, or expose configuration secrets.";
  }

  const parts = [];
  const parsedToolPayloads = [];
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
      `I have prepared a confirmation card for **${action.title}** (${action.description}). Please review the details on the card below and click **Confirm** to apply this change.`,
    );
  }

  for (const toolItem of parsedToolPayloads) {
    const { name, data } = toolItem;
    if (!data || data.error) continue;

    if (name === "run_resume_match") {
      parts.push(
        `### Resume Match: ${data.jobTitle} at ${data.company}\n- **Overall Match Score**: **${data.score}%** (${data.band} fit)\n- **Matched Must-Haves**: ${(data.mustHaveMatched || []).join(", ") || "None detected yet"}\n- **Missing Must-Haves**: ${(data.mustHaveMissing || []).join(", ") || "None"}\n- **ATS Readiness**: ${data.atsReadinessScore ?? "N/A"}%`,
      );
    } else if (name === "get_job") {
      parts.push(
        `### Job Overview: ${data.title} at ${data.company}\n- **Location**: ${data.location || "Unspecified"} (${data.remoteType})\n- **Profile Fit**: ${data.score !== null ? `${data.score}% (${data.scoreBand})` : "Upload resume to score"}\n- **Eligibility**: ${data.eligibility}\n- **Key Requirements**: ${(data.requirements || []).slice(0, 6).join(", ") || "See job description"}`,
      );
    } else if (name === "search_jobs") {
      const jobs = data.jobs || [];
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
      const apps = data.applications || [];
      const stats = data.stats || {};
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
      const sessions = data.sessions || [];
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
      const roles = (data.roles || []).map((r) => `${r.title} at ${r.company}`).filter(Boolean);
      const skills = (data.skills || []).slice(0, 10);
      parts.push(
        `### Grounded Resume Snapshot\n- **Roles**: ${roles.join("; ") || "No roles parsed yet"}\n- **Verified Skills**: ${skills.join(", ") || "No skills parsed yet"}`,
      );
    } else if (name === "get_career_profile_status") {
      parts.push(
        `### Career Profile Status (${data.completenessPercent}% complete)\n- **Target Roles**: ${(data.targetRoles || []).join(", ") || "Not set"}\n- **Preferred Locations**: ${(data.preferredLocations || []).join(", ") || "Not set"}\n- **Work Mode**: ${data.workMode}\n- **Missing Fields**: ${(data.missingFields || []).join(", ") || "None — profile is complete!"}`,
      );
    } else if (name === "get_profile_summary") {
      const p = data.profile || {};
      parts.push(
        `### Candidate Snapshot\n- **Current Role**: ${p.currentRole || "Not specified"}\n- **Target Roles**: ${(p.targetRoles || []).join(", ") || "Not set"}\n- **Top Skills**: ${(p.skills || []).join(", ") || "Not set"}\n- **Location**: ${p.location || "Not set"}`,
      );
    } else if (name === "search_memories") {
      const mems = data.memories || [];
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

const ChatStateAnnotation = Annotation.Root({
  userId: Annotation({ reducer: (_, next) => next, default: () => "" }),
  threadId: Annotation({ reducer: (_, next) => next, default: () => "" }),
  prompt: Annotation({ reducer: (_, next) => next, default: () => "" }),
  pageContext: Annotation({ reducer: (_, next) => next, default: () => null }),
  rollingSummary: Annotation({ reducer: (_, next) => next, default: () => "" }),
  historyMessages: Annotation({ reducer: (_, next) => next, default: () => [] }),
  decision: Annotation({ reducer: (_, next) => next, default: () => null }),
  entitlements: Annotation({ reducer: (_, next) => next, default: () => null }),
  candidateCard: Annotation({ reducer: (_, next) => next, default: () => ({}) }),
  resolvedPageContext: Annotation({ reducer: (_, next) => next, default: () => null }),
  relevantMemories: Annotation({ reducer: (_, next) => next, default: () => [] }),
  telemetry: Annotation({ reducer: (_, next) => next, default: () => ({}) }),
  messages: Annotation({
    reducer: (prev, next) => (Array.isArray(next) ? next : [...(prev || []), next]),
    default: () => [],
  }),
  toolCallsExecuted: Annotation({ reducer: (_, next) => next, default: () => 0 }),
  toolIterations: Annotation({ reducer: (_, next) => next, default: () => 0 }),
  toolResults: Annotation({
    reducer: (prev, next) => [...(prev || []), ...(Array.isArray(next) ? next : [next])],
    default: () => [],
  }),
  sourcesUsed: Annotation({
    reducer: (prev, next) => [
      ...new Set([...(prev || []), ...(Array.isArray(next) ? next : [next])]),
    ],
    default: () => [],
  }),
  proposedActions: Annotation({
    reducer: (prev, next) => [...(prev || []), ...(Array.isArray(next) ? next : [next])],
    default: () => [],
  }),
  responseText: Annotation({ reducer: (_, next) => next, default: () => "" }),
  injectionBlocked: Annotation({ reducer: (_, next) => next, default: () => false }),
});

/**
 * Builds and compiles the LangGraph StateGraph for the Production Chat Agent.
 */
export function buildChatStateGraph({ checkpointer = null } = {}) {
  const workflow = new StateGraph(ChatStateAnnotation)
    .addNode("classifyAndRoute", async (state, config) => {
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

      const assembled = await assembleChatContext({
        user,
        prompt: state.prompt,
        pageContext: state.pageContext,
        rollingSummary: state.rollingSummary,
        historyMessages: state.historyMessages,
        needsMemory: decision.needsMemory !== false,
        turnTokenBudget: entitlements.turnTokenBudget,
      });

      const injectionBlocked = isPromptInjectionAttempt(state.prompt);
      const lcMessages = assembled.messages.map((m) =>
        m.role === "system"
          ? new SystemMessage(m.content)
          : m.role === "assistant"
            ? new AIMessage(m.content)
            : new HumanMessage(m.content),
      );

      // Apply budget-degradation or plan tier override
      const requestedModelTier =
        decision.tier === 2 || decision.tier === "strong" ? "strong" : "small";
      const effectiveModelTier =
        entitlements.modelTier === "small" && requestedModelTier === "strong"
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
    .addNode("agentNode", async (state, config) => {
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

      const tools = canCallTools ? createChatTools(config) : [];
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
          const type = msg._getType ? msg._getType() : msg.role;
          if (type === "system") return { role: "system", content: msg.content };
          if (type === "tool") {
            return {
              role: "tool",
              content: msg.content,
              tool_call_id: msg.tool_call_id,
              name: msg.name,
            };
          }
          if (type === "ai" || type === "assistant") {
            return {
              role: "assistant",
              content: msg.content || "",
              ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
            };
          }
          return { role: "user", content: msg.content };
        });

        const llmOut = await invokeLLM({
          user,
          tier: state.decision?.modelTier || (state.decision?.tier === 2 ? "strong" : "small"),
          feature: "chat",
          prompt: promptPayload,
          tools: canCallTools ? tools : undefined,
          mockResponder,
          maxTokens: 1000,
          metadata: {
            threadId: state.threadId,
            toolIterations: state.toolIterations,
          },
        });

        if (
          llmOut &&
          typeof llmOut === "object" &&
          Array.isArray(llmOut.tool_calls) &&
          llmOut.tool_calls.length > 0 &&
          canCallTools
        ) {
          return {
            messages: [
              ...state.messages,
              new AIMessage({
                content: String(llmOut.content || ""),
                tool_calls: llmOut.tool_calls,
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

        const textContent = typeof llmOut === "string" ? llmOut : String(llmOut?.content || "");
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
      } catch (err) {
        logger.warn(
          { err: err.message, userId: state.userId },
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
    .addNode("toolExecutorNode", async (state, config) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const requestedCalls = Array.isArray(lastMessage?.tool_calls) ? lastMessage.tool_calls : [];
      const user = config?.configurable?.user || {
        _id: state.userId,
        id: state.userId,
        plan: "free",
      };
      const entitlements = state.entitlements || (await quotaService.getChatEntitlements(user));
      const remainingBudget = Math.max(
        0,
        Math.min(
          MAX_TOOL_ITERATIONS - state.toolCallsExecuted,
          (entitlements.maxToolCallsPerTurn || 2) - state.toolCallsExecuted,
          entitlements.toolCallsRemainingDaily ?? 25,
        ),
      );
      const callsToRun = requestedCalls.slice(0, remainingBudget);
      const onToolStatus = config?.configurable?.onToolStatus;
      const newSources = [];
      const newProposedActions = [];

      const toolConfig = {
        configurable: {
          ...config?.configurable,
          user,
          userId: state.userId,
          onToolComplete: ({ sourceLabel, proposedAction }) => {
            if (sourceLabel) newSources.push(sourceLabel);
            if (proposedAction) newProposedActions.push(proposedAction);
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
          const statusLabel = TOOL_STATUS_LABELS[toolName] || `Running ${toolName}...`;
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
                user.plan || "free",
              )
              .catch(() => {});

            const parsedArgs = toolInstance.schema.parse(call.args || {});
            const output = await withTimeout(
              toolInstance.func(parsedArgs, toolConfig),
              timeoutMs,
              toolName,
            );
            if (TOOL_SOURCE_LABELS[toolName]) {
              newSources.push(TOOL_SOURCE_LABELS[toolName]);
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
          } catch (err) {
            logger.warn(
              { err: err.message, toolName, userId: state.userId },
              "Chat tool execution failed or timed out",
            );
            const errorPayload = wrapUntrustedToolResult(toolName, {
              error: err.code || "TOOL_EXECUTION_ERROR",
              message:
                err.code === "TOOL_TIMEOUT"
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
      const lastMsg = state.messages[state.messages.length - 1];
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
}) {
  const userId = (user?._id || user?.id)?.toString();
  if (!userId) throw new Error("Authenticated user is required to run chat agent.");

  let checkpointer = null;
  try {
    checkpointer = getCheckpointer();
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
        onToolStatus,
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
