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
import { logger } from "../../shared/utils/logger.js";

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

const BulletSchema = z.object({
  factId: z.string(),
  tailoredBullet: z.string(),
  usedKeywords: z.array(z.string()).default([]),
});

const BulletsResponseSchema = z.object({
  bullets: z.array(BulletSchema),
  summary: z.string().default(""),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse JD text into structured requirements
 * @param {string} jdText
 * @param {object} user
 * @returns {Promise<object>}
 */
async function parseJD(jdText, user) {
  const prompt = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Extract structured requirements from this job description:\n\n${jdText.slice(0, 4000)}`,
        },
      ],
    },
  ];

  return invokeLLM({
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
 * @param {object[]} profileFacts - Flattened list of { factId, content, type }
 * @param {object} requirements
 * @returns {{ factId: string, content: string, relevantKeywords: string[] }[]}
 */
function mapFactsToRequirements(profileFacts, requirements) {
  const keywords = [
    ...(requirements.requiredSkills || []),
    ...(requirements.preferredSkills || []),
    ...(requirements.atsKeywords || []),
  ].map((k) => k.toLowerCase());

  return profileFacts
    .map((fact) => {
      const text = (fact.content || fact.description || fact.name || "").toLowerCase();
      const relevantKeywords = keywords.filter(
        (kw) => text.includes(kw) || (fact.skills || []).some((s) => s.toLowerCase().includes(kw)),
      );
      return { ...fact, relevantKeywords };
    })
    .filter((f) => f.relevantKeywords.length > 0 || f.type === "achievement");
}

/**
 * Draft tailored bullets using mapped facts
 * @param {object[]} mappedFacts
 * @param {object} requirements
 * @param {string} jobTitle
 * @param {string} company
 * @param {object} user
 * @returns {Promise<object>}
 */
async function draftBullets(mappedFacts, requirements, jobTitle, company, user) {
  const factsText = mappedFacts
    .slice(0, 15)
    .map((f) => `factId: ${f.factId} | content: ${f.content || f.description || f.name}`)
    .join("\n");

  const prompt = [
    {
      role: "user",
      content: [
        {
          type: "text",
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

  return invokeLLM({
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
 * @param {object[]} bullets
 * @param {Set<string>} validFactIds
 * @returns {{ valid: boolean, invalidBullets: object[] }}
 */
function truthfulnessCheck(bullets, validFactIds) {
  const invalidBullets = bullets.filter((b) => !b.factId || !validFactIds.has(b.factId));
  return {
    valid: invalidBullets.length === 0,
    invalidBullets,
  };
}

/**
 * Calculate ATS keyword coverage
 * @param {object[]} bullets
 * @param {string[]} atsKeywords
 * @returns {{ score: number, covered: string[], missing: string[] }}
 */
function atsKeywordCheck(bullets, atsKeywords) {
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
 * @param {object} profile
 * @returns {{ factId: string, content: string, type: string }[]}
 */
function flattenProfileFacts(profile) {
  const facts = [];
  if (!profile) return facts;

  // Roles + achievements
  for (const role of profile.roles || []) {
    facts.push({
      factId: role.factId,
      content: `${role.title} at ${role.company} (${role.startDate || ""}-${role.endDate || "present"})`,
      type: "role",
      skills: role.skills || [],
    });
    for (const ach of role.achievements || []) {
      facts.push({
        factId: ach.factId,
        content: ach.bullet || ach.description || "",
        type: "achievement",
        skills: [],
      });
    }
  }

  // Skills
  for (const skill of profile.skills || []) {
    facts.push({
      factId: skill.factId,
      content: skill.name,
      type: "skill",
      skills: [skill.name],
    });
  }

  // Education
  for (const edu of profile.education || []) {
    facts.push({
      factId: edu.factId,
      content: `${edu.degree} in ${edu.field} from ${edu.institution}`,
      type: "education",
      skills: [],
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Mock tailoring for dev/test mode
// ---------------------------------------------------------------------------
function mockTailoring(profile, jobId) {
  const profileFacts = flattenProfileFacts(profile);
  const validFactIds = new Set(profileFacts.map((f) => f.factId));
  const topFacts = profileFacts.slice(0, 5);

  const bullets = topFacts.map((f, i) => ({
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
   * @param {object} params
   * @param {object} params.user
   * @param {object} params.profile - structured profile with roles, skills, achievements
   * @param {string} params.jobId
   * @param {string} params.jobTitle
   * @param {string} params.company
   * @param {string} params.jdText - raw job description text
   * @returns {Promise<object>} Draft tailoring result (awaiting human approval)
   */
  async runTailoring({ user, profile, jobId, jobTitle, company, jdText }) {
    const userId = user._id ? user._id.toString() : user.id || "anon";
    const isDev =
      process.env.ANTHROPIC_API_KEY === "dummy_anthropic_key_for_dev" ||
      process.env.NODE_ENV === "test";

    if (isDev) {
      logger.info({ userId, jobId }, "tailoringGraph: mock mode");
      const mock = mockTailoring(profile, jobId);
      return {
        status: "awaiting_approval",
        jobId,
        jobTitle: jobTitle || "Software Engineer",
        company: company || "Target Company",
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
    let requirements;
    try {
      requirements = await parseJD(jdText || `${jobTitle} at ${company}`, user);
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
    let bullets = [];
    let summary = "";
    let retryCount = 0;
    const MAX_RETRIES = 2;

    while (retryCount <= MAX_RETRIES) {
      logger.info({ userId, jobId, retryCount }, "tailoringGraph: drafting bullets");
      const draftResult = await draftBullets(factsForDraft, requirements, jobTitle, company, user);
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
    const normalizedBullets = bullets.map((b) => ({
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
      jobTitle,
      company,
      bullets: normalizedBullets,
      validFactIds: [...validFactIds],
      summary,
      atsMatch,
      requirements,
      retryCount,
    };
  },
};
