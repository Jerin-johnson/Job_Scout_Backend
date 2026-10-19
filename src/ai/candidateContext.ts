import mongoose from "mongoose";
import { Application } from "../models/Application.js";
import { InterviewReport } from "../models/InterviewReport.js";
import { InterviewSession } from "../models/InterviewSession.js";
import { Resume } from "../models/Resume.js";
import { applicationRepository } from "../repositories/applicationRepository.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { isMongoReady } from "../config/database.js";
import { getOrSet, CacheKeys, del, get } from "../shared/cache.js";

const CONTEXT_TTL_SECONDS = 60;
const MAX_CONTEXT_CHARS = 1800;
const STALE_DAYS = 7;

export interface CandidateCard {
  preferredName: string;
  currentRole: string;
  targetRoles: string[];
  yearsExperience: number | null;
  skills: string[];
  location: string;
  plan: string;
  activeApplications: number;
  followUpsDue: number;
  hasResume: boolean;
  lastInterviewScore: number | null;
}

export interface CandidateContextSuggestion {
  label: string;
  prompt: string;
}

export interface CandidateContextResult {
  card: CandidateCard;
  text: string;
  suggestions: CandidateContextSuggestion[];
  cacheHit?: boolean;
}

function safeText(value: unknown, max = 160): string {
  return String(value || "")
    .replace(/[<>]/g, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

interface RoleLike {
  title?: string;
  company?: string;
  startDate?: string | Date;
  isCurrent?: boolean;
}

function yearsExperience(roles: RoleLike[] = []): number | null {
  const starts = roles
    .map((role) => (role.startDate ? Date.parse(String(role.startDate)) : NaN))
    .filter(Number.isFinite);
  if (!starts.length) return null;
  return Math.max(0, Math.min(60, Math.floor((Date.now() - Math.min(...starts)) / 31_557_600_000)));
}

export function formatCandidateContext(card: Partial<CandidateCard> = {}): string {
  const fields: Array<[string, unknown]> = [
    ["Preferred name", card.preferredName],
    ["Current role", card.currentRole],
    ["Target roles", (card.targetRoles || []).join(", ")],
    [
      "Experience",
      card.yearsExperience === null || card.yearsExperience === undefined
        ? ""
        : `${card.yearsExperience} years`,
    ],
    ["Top skills", (card.skills || []).join(", ")],
    ["Location", card.location],
    ["Plan tier", card.plan],
    ["Active applications", card.activeApplications],
    ["Follow-ups due", card.followUpsDue],
    [
      "Last interview score",
      card.lastInterviewScore === null || card.lastInterviewScore === undefined
        ? ""
        : `${card.lastInterviewScore}/100`,
    ],
    ["Resume available", card.hasResume ? "yes" : "no"],
  ];
  const text = fields
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([label, value]) => `${label}: ${safeText(Array.isArray(value) ? value.join(", ") : value)}`)
    .join("\n");
  return text.slice(0, MAX_CONTEXT_CHARS);
}

export interface UserLike {
  _id?: unknown;
  id?: unknown;
  preferredName?: string;
  name?: string;
  plan?: string;
  planVersion?: string;
  profileVersion?: number;
  memoriesPaused?: boolean;
}

async function loadCandidateContext(
  userId: string | mongoose.Types.ObjectId,
  user?: UserLike | null,
): Promise<CandidateContextResult> {
  const id = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(String(userId)) : userId;
  const profilePromise = profileRepository.findByUserId(id);
  const countsPromise: Promise<[number, number, boolean, { _id: unknown } | null]> = isMongoReady()
    ? Promise.all([
        Application.countDocuments({ userId: id, archivedAt: null }),
        Application.countDocuments({
          userId: id,
          archivedAt: null,
          nextFollowUpAt: { $lte: new Date() },
        }),
        Resume.exists({ userId: id }).then(Boolean),
        InterviewSession.findOne({ userId: id, status: "completed" })
          .sort({ completedAt: -1, updatedAt: -1 })
          .select("_id")
          .lean() as Promise<{ _id: unknown } | null>,
      ])
    : applicationRepository.getBoardStats(id).then(async (stats) => {
        const resumes = await profileRepository.findResumesByUserId(id);
        return [
          stats.totalActive,
          stats.followUpsDue,
          resumes.length > 0,
          null as { _id: unknown } | null,
        ];
      });

  const [profile, [activeApplications, followUpsDue, hasResume, latestInterview]] = await Promise.all([
    profilePromise,
    countsPromise,
  ]);
  let lastInterviewScore: number | null = null;
  if (latestInterview && isMongoReady()) {
    const report = (await InterviewReport.findOne({ interviewId: latestInterview._id, userId: id })
      .select("report.overallScore")
      .lean()) as { report?: { overallScore?: number } } | null;
    const score = report?.report?.overallScore;
    if (typeof score === "number" && Number.isFinite(score)) lastInterviewScore = score;
  }

  const roles = (profile?.roles || []) as RoleLike[];
  const current = roles.find((role) => role.isCurrent) || roles[0];
  const preferences = (profile?.preferences || {}) as { targetRoles?: string[]; preferredLocations?: string[] };
  const rawSkills = (profile?.skills || []) as unknown[];
  const card: CandidateCard = {
    preferredName: safeText(user?.preferredName || user?.name || "", 80),
    currentRole: current
      ? `${safeText(current.title, 80)}${current.company ? ` at ${safeText(current.company, 80)}` : ""}`
      : "",
    targetRoles: (preferences.targetRoles || []).slice(0, 5).map((item: string) => safeText(item, 60)),
    yearsExperience: yearsExperience(roles),
    skills: rawSkills.slice(0, 8).map((skill: unknown) => typeof skill === "string" ? safeText(skill, 40) : safeText((skill as { name?: string })?.name, 40)),
    location: (preferences.preferredLocations || [])
      .slice(0, 3)
      .map((item: string) => safeText(item, 50))
      .join(", "),
    plan: safeText(user?.plan || "free", 24),
    activeApplications,
    followUpsDue,
    hasResume: Boolean(hasResume),
    lastInterviewScore,
  };
  return { card, text: formatCandidateContext(card), suggestions: buildSuggestions(card) };
}

function buildSuggestions(card: CandidateCard): CandidateContextSuggestion[] {
  const suggestions: CandidateContextSuggestion[] = [];
  if (card.followUpsDue > 0)
    suggestions.push({
      label: "Review follow-ups",
      prompt: "Help me plan my overdue job follow-ups.",
    });
  if (!card.hasResume)
    suggestions.push({
      label: "Add your resume",
      prompt: "How can I upload my resume and get tailored career help?",
    });
  if (!card.targetRoles?.length)
    suggestions.push({
      label: "Set target roles",
      prompt: "Help me choose target roles based on my experience.",
    });
  if (card.lastInterviewScore !== null && card.lastInterviewScore !== undefined)
    suggestions.push({
      label: "Improve interview score",
      prompt: "Help me improve my last mock interview score.",
    });
  if (card.activeApplications > 0)
    suggestions.push({
      label: "Review my job search",
      prompt: "Help me prioritize my active applications.",
    });
  else
    suggestions.push({
      label: "Plan your first application",
      prompt: "Help me plan the first step in my job search.",
    });
  if (!suggestions.length)
    suggestions.push({
      label: "Plan your next step",
      prompt: "Help me choose a practical next step in my job search.",
    });
  return suggestions.slice(0, 3);
}

export function candidateContextKey(userId: string): string {
  return CacheKeys.response(userId, "candidate-context", 1);
}

export async function getCandidateContext(user?: UserLike | null): Promise<CandidateContextResult> {
  const userId = user?._id?.toString() || user?.id?.toString();
  if (!userId) throw new Error("Authenticated user is required to build chat context.");
  const key = candidateContextKey(userId);
  const cached = await get<CandidateContextResult>(key);
  if (cached) return { ...cached, cacheHit: true };
  const value = await getOrSet(key, () => loadCandidateContext(userId, user), CONTEXT_TTL_SECONDS);
  return { ...value, cacheHit: false };
}

export async function invalidateCandidateContext(userId?: string | mongoose.Types.ObjectId | null): Promise<void> {
  if (userId) await del(candidateContextKey(userId.toString()));
}

export const candidateContextConfig = { CONTEXT_TTL_SECONDS, MAX_CONTEXT_CHARS, STALE_DAYS };
