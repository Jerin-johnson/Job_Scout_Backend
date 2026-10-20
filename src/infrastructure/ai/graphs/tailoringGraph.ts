/**
 * @fileoverview Resume Tailoring Graph (Graph B)
 *
 * Flow:
 *   parseJD -> extractRequirements -> mapToProfileFacts -> draftBullets ->
 *   truthfulnessCheck -> atsKeywordCheck -> interrupt (human approval) -> export
 *
 * truthfulnessCheck: every bullet MUST reference a factId from the user profile.
 * Bullets without valid factIds are rejected and regenerated (max 2 retries).
 * The agent NEVER invents experience.
 */

import { invokeLLM } from "../llm.js";
import { z } from "zod";
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

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
const RequirementsSchema = z.object({
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  keyResponsibilities: z.array(z.string()),
  atsKeywords: z.array(z.string()),
  seniorityLevel: z.string().default("mid"),
});

export type JobRequirements = z.infer<typeof RequirementsSchema>;

const BulletSchema = z.object({
  factId: z.string(),
  tailoredBullet: z.string(),
  usedKeywords: z.array(z.string()).default([]),
});

export type TailoredBullet = z.infer<typeof BulletSchema>;

const BulletsResponseSchema = z.object({
  bullets: z.array(BulletSchema),
  summary: z.string().default(""),
});

export type BulletsResponse = z.infer<typeof BulletsResponseSchema>;

export interface FlatProfileFact {
  factId: string;
  content: string;
  type: string;
  skills?: string[];
  relevantKeywords?: string[];
}

export interface NormalizedBullet {
  factId: string;
  originalBullet: string;
  tailoredBullet: string;
  isVerified: boolean;
  usedKeywords: string[];
}

export interface AtsMatchResult {
  score: number;
  covered: string[];
  missing: string[];
}

export interface TailoringResult {
  status: string;
  jobId?: string;
  jobTitle: string;
  company: string;
  bullets: NormalizedBullet[];
  validFactIds: string[];
  summary: string;
  atsMatch: AtsMatchResult;
  requirements: JobRequirements;
  retryCount: number;
}

export interface ProfileWithFacts {
  roles?: Array<Record<string, unknown>> | unknown[];
  skills?: Array<Record<string, unknown>> | unknown[];
  education?: Array<Record<string, unknown>> | unknown[];
  [key: string]: unknown;
}

export interface RunTailoringParams {
  user: UserLike;
  profile?: ProfileWithFacts | null;
  jobId?: string;
  jobTitle?: string;
  company?: string;
  jdText?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse JD text into structured requirements
 */
async function parseJD(jdText: string, user: UserLike): Promise<JobRequirements> {
  const prompt = [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `Extract structured requirements from this job description:\n\n${jdText.slice(0, 4000)}`,
        },
      ],
    },
  ];

  return invokeLLM<JobRequirements>({
    user,
    tier: "small",
    feature: "extract",
    prompt,
    schema: RequirementsSchema,
    maxTokens: 800,
  });
}

/**
 * Map ATS keywords to profile factIds
 */
function mapFactsToRequirements(
  profileFacts: FlatProfileFact[],
  requirements: JobRequirements,
): FlatProfileFact[] {
  const keywords = [
    ...(requirements.requiredSkills || []),
    ...(requirements.preferredSkills || []),
    ...(requirements.atsKeywords || []),
  ].map((k) => k.toLowerCase());

  return profileFacts
    .map((fact) => {
      const text = (fact.content || "").toLowerCase();
      const relevantKeywords = keywords.filter(
        (kw) => text.includes(kw) || (fact.skills || []).some((s) => s.toLowerCase().includes(kw)),
      );
      return { ...fact, relevantKeywords };
    })
    .filter(
      (f) => (f.relevantKeywords && f.relevantKeywords.length > 0) || f.type === "achievement",
    );
}

/**
 * Draft tailored bullets using mapped facts
 */
async function draftBullets(
  mappedFacts: FlatProfileFact[],
  requirements: JobRequirements,
  jobTitle: string,
  company: string,
  user: UserLike,
): Promise<BulletsResponse> {
  const factsText = mappedFacts
    .slice(0, 15)
    .map((f) => `factId: ${f.factId} | content: ${f.content}`)
    .join("\n");

  const prompt = [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `You are a resume writer. Create tailored resume bullets for the role "${jobTitle}" at "${company}".
STRICT RULES:
1. Every bullet MUST use EXACTLY one factId from the provided facts. Never invent experience.
2. Bullets should incorporate ATS keywords naturally.
3. Use STAR format where possible.
4. Return ${Math.min(mappedFacts.length, 8)} bullets.

Profile Facts:
${factsText}

Job Requirements:
- Required Skills: ${requirements.requiredSkills?.join(", ") || "N/A"}
- ATS Keywords: ${requirements.atsKeywords?.join(", ") || "N/A"}
- Key Responsibilities: ${requirements.keyResponsibilities?.slice(0, 3).join("; ") || "N/A"}

Return a JSON object with "bullets" array (each: factId, tailoredBullet, usedKeywords[]) and "summary" string.`,
        },
      ],
    },
  ];

  return invokeLLM<BulletsResponse>({
    user,
    tier: "strong",
    feature: "tailor_resume",
    prompt,
    schema: BulletsResponseSchema,
    maxTokens: 1500,
  });
}

/**
 * Verify that every bullet has a valid factId from the user's profile
 */
function truthfulnessCheck(
  bullets: TailoredBullet[],
  validFactIds: Set<string>,
): { valid: boolean; invalidBullets: TailoredBullet[] } {
  const invalidBullets = bullets.filter((b) => !b.factId || !validFactIds.has(b.factId));
  return {
    valid: invalidBullets.length === 0,
    invalidBullets,
  };
}

/**
 * Calculate ATS keyword coverage
 */
function atsKeywordCheck(
  bullets: Array<{ tailoredBullet: string }>,
  atsKeywords: string[],
): AtsMatchResult {
  if (!atsKeywords || atsKeywords.length === 0) {
    return { score: 100, covered: [], missing: [] };
  }
  const allText = bullets.map((b) => b.tailoredBullet.toLowerCase()).join(" ");
  const covered = atsKeywords.filter((kw) => allText.includes(kw.toLowerCase()));
  const missing = atsKeywords.filter((kw) => !allText.includes(kw.toLowerCase()));
  const score = Math.round((covered.length / atsKeywords.length) * 100);
  return { score, covered, missing };
}

/**
 * Flatten profile facts into a uniform list
 */
function flattenProfileFacts(profile?: ProfileWithFacts | null): FlatProfileFact[] {
  const facts: FlatProfileFact[] = [];
  if (!profile) return facts;

  // Roles + achievements
  for (const rawRole of (profile.roles || []) as Array<Record<string, unknown>>) {
    const role = rawRole as {
      factId?: string;
      title?: string;
      company?: string;
      startDate?: string;
      endDate?: string;
      skills?: string[];
      achievements?: Array<{ factId?: string; bullet?: string; description?: string }>;
    };
    if (role.factId) {
      facts.push({
        factId: role.factId,
        content: `${role.title || "Role"} at ${role.company || "Company"} (${role.startDate || ""}-${role.endDate || "present"})`,
        type: "role",
        skills: role.skills || [],
      });
    }
    for (const ach of role.achievements || []) {
      if (ach.factId) {
        facts.push({
          factId: ach.factId,
          content: ach.bullet || ach.description || "",
          type: "achievement",
          skills: [],
        });
      }
    }
  }

  // Skills
  for (const rawSkill of (profile.skills || []) as Array<Record<string, unknown>>) {
    const skill = rawSkill as { factId?: string; name?: string };
    if (skill.factId && skill.name) {
      facts.push({
        factId: skill.factId,
        content: skill.name,
        type: "skill",
        skills: [skill.name],
      });
    }
  }

  // Education
  for (const rawEdu of (profile.education || []) as Array<Record<string, unknown>>) {
    const edu = rawEdu as {
      factId?: string;
      degree?: string;
      field?: string;
      institution?: string;
    };
    if (edu.factId) {
      facts.push({
        factId: edu.factId,
        content: `${edu.degree || "Degree"} in ${edu.field || "Field"} from ${edu.institution || "Institution"}`,
        type: "education",
        skills: [],
      });
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Mock tailoring for dev/test mode
// ---------------------------------------------------------------------------
function mockTailoring(profile?: ProfileWithFacts | null, _jobId?: string) {
  const profileFacts = flattenProfileFacts(profile);
  const validFactIds = new Set(profileFacts.map((f) => f.factId));
  const topFacts = profileFacts.slice(0, 5);

  const bullets: NormalizedBullet[] = topFacts.map((f, i) => ({
    factId: f.factId,
    originalBullet: f.content,
    tailoredBullet: `[Tailored] ${f.content} — Aligned with target role requirements.`,
    isVerified: true,
    usedKeywords: ["node.js", "api"][i % 2] ? [["node.js", "api"][i % 2]] : [],
  }));

  return {
    bullets,
    validFactIds: [...validFactIds],
    requirements: {
      requiredSkills: ["Node.js", "Express"],
      preferredSkills: ["MongoDB"],
      atsKeywords: ["node.js", "api", "backend"],
      keyResponsibilities: ["Build APIs", "Design systems"],
      seniorityLevel: "senior",
    },
    atsMatch: {
      score: 85,
      covered: ["node.js", "api"],
      missing: ["backend"],
    },
    summary: "Experienced engineer with proven track record in scalable backend systems.",
  };
}

// ---------------------------------------------------------------------------
// Main graph runner
// ---------------------------------------------------------------------------
export const tailoringGraph = {
  /**
   * Run the resume tailoring graph
   */
  async runTailoring({
    user,
    profile,
    jobId,
    jobTitle,
    company,
    jdText,
  }: RunTailoringParams): Promise<TailoringResult> {
    const userId = user._id ? String(user._id) : String(user.id || "anon");
    const isDev =
      process.env.ANTHROPIC_API_KEY === "dummy_anthropic_key_for_dev" ||
      process.env.NODE_ENV === "test";

    const title = jobTitle || "Software Engineer";
    const comp = company || "Target Company";

    if (isDev) {
      logger.info({ userId, jobId }, "tailoringGraph: mock mode");
      const mock = mockTailoring(profile, jobId);
      return {
        status: "awaiting_approval",
        jobId,
        jobTitle: title,
        company: comp,
        bullets: mock.bullets,
        validFactIds: mock.validFactIds,
        summary: mock.summary,
        atsMatch: mock.atsMatch,
        requirements: mock.requirements,
        retryCount: 0,
      };
    }

    // --- Step 1: Flatten profile facts ---
    const profileFacts = flattenProfileFacts(profile);
    const validFactIds = new Set(profileFacts.map((f) => f.factId));

    if (profileFacts.length === 0) {
      throw Object.assign(new Error("Profile has no facts. Upload a resume first."), {
        code: "NO_PROFILE_FACTS",
        statusCode: 400,
      });
    }

    // --- Step 2: Parse JD ---
    logger.info({ userId, jobId }, "tailoringGraph: parsing JD");
    let requirements: JobRequirements;
    try {
      requirements = await parseJD(jdText || `${title} at ${comp}`, user);
    } catch {
      requirements = {
        requiredSkills: [],
        preferredSkills: [],
        atsKeywords: [],
        keyResponsibilities: [],
        seniorityLevel: "mid",
      };
    }

    // --- Step 3: Map facts to requirements ---
    const mappedFacts = mapFactsToRequirements(profileFacts, requirements);
    const factsForDraft = mappedFacts.length > 0 ? mappedFacts : profileFacts.slice(0, 10);

    // --- Step 4: Draft bullets (with retry on truthfulness failure) ---
    let bullets: TailoredBullet[] = [];
    let summary = "";
    let retryCount = 0;
    const MAX_RETRIES = 2;

    while (retryCount <= MAX_RETRIES) {
      logger.info({ userId, jobId, retryCount }, "tailoringGraph: drafting bullets");
      const draftResult = await draftBullets(factsForDraft, requirements, title, comp, user);
      bullets = draftResult.bullets || [];
      summary = draftResult.summary || "";

      // --- Step 5: Truthfulness check ---
      const { valid, invalidBullets } = truthfulnessCheck(bullets, validFactIds);
      if (valid) break;

      logger.warn(
        { userId, invalidCount: invalidBullets.length, retryCount },
        "tailoringGraph: truthfulness check failed, retrying",
      );
      retryCount++;

      if (retryCount > MAX_RETRIES) {
        // Filter out invalid bullets rather than rejecting entirely
        bullets = bullets.filter((b) => validFactIds.has(b.factId));
        break;
      }
    }

    // Normalize bullets to include originalBullet and isVerified
    const normalizedBullets: NormalizedBullet[] = bullets.map((b) => ({
      factId: b.factId,
      originalBullet: profileFacts.find((f) => f.factId === b.factId)?.content || "",
      tailoredBullet: b.tailoredBullet,
      isVerified: validFactIds.has(b.factId),
      usedKeywords: b.usedKeywords || [],
    }));

    // --- Step 6: ATS keyword check ---
    const atsMatch = atsKeywordCheck(normalizedBullets, requirements.atsKeywords);
    logger.info({ userId, jobId, atsScore: atsMatch.score }, "tailoringGraph: ATS check");

    return {
      status: "awaiting_approval",
      jobId,
      jobTitle: title,
      company: comp,
      bullets: normalizedBullets,
      validFactIds: [...validFactIds],
      summary,
      atsMatch,
      requirements,
      retryCount,
    };
  },
};
