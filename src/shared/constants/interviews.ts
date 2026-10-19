export interface RubricDimension {
  name: string;
  weight: number;
  anchors: { 1: string; 3: string; 5: string };
}

export interface BuildModeParams {
  id: string;
  label: string;
  description: string;
  persona: string;
  tone: string;
  pacing: string;
  weakAnswer: string;
  phases: Record<string, number>;
  focus: string;
  rubric: RubricDimension[];
  redFlags: string[];
}

export interface InterviewModeConfig {
  id: string;
  label: string;
  description: string;
  promptVersion: string;
  persona: { name: string; tone: string; pacing: string; reactsToWeakAnswers: string };
  phases: Record<string, number>;
  questionStrategy: string[];
  difficultyCalibration: {
    byLevel: Record<string, string>;
    byRoleFamily: Record<string, string>;
  };
  rubric: RubricDimension[];
  redFlags: string[];
  antiPatterns: string[];
}

export const INTERVIEW_CONSENT_VERSION = "2026-10-15-v1";
export const INTERVIEW_REPORT_SCHEMA_VERSION = "2";

export const INTERVIEW_PROMPT_VERSION = "2026-10-15-v2";

const ROLE_FAMILY_DIFFICULTY = {
  engineering:
    "Probe design, reliability, debugging, correctness, and tradeoffs appropriate to the target level.",
  product:
    "Probe discovery, prioritization, strategy, measurable outcomes, and stakeholder alignment.",
  data: "Probe experimental design, data quality, statistical judgment, and decision impact.",
  design: "Probe user research, interaction decisions, accessibility, iteration, and impact.",
  marketing: "Probe audience insight, channel strategy, experimentation, and attributable results.",
  sales: "Probe discovery, qualification, negotiation, pipeline judgment, and customer outcomes.",
  operations: "Probe process design, risk management, execution, and measurable efficiency.",
  generic: "Probe role-relevant judgment and evidence without assuming a specialty.",
};

const LEVEL_DIFFICULTY = {
  fresher: "Assess fundamentals, learning agility, and clearly scoped contributions.",
  mid: "Assess independent ownership, sound tradeoffs, and cross-functional delivery.",
  senior: "Assess strategic judgment, ambiguity, leverage, mentoring, and organizational impact.",
};

const COMMON_RULES = [
  "Derive questions from specific resume claims, gaps_or_weak_points, and job requirements.",
  "Vague answer: ask for one specific example. Metric claim: ask how it was measured. We-answer: ask what the candidate personally did.",
  "Strong evidence: raise difficulty. Weak evidence: ask at most one follow-up, then move on respectfully.",
  "Never give hints or feedback mid-interview. Ask one question at a time, never repeat a question or topic, and keep each spoken-style turn to at most two sentences.",
];

function dimension(name: string, weight: number, one: string, three: string, five: string): RubricDimension {
  return { name, weight, anchors: { 1: one, 3: three, 5: five } };
}

function buildMode({
  id,
  label,
  description,
  persona,
  tone,
  pacing,
  weakAnswer,
  phases,
  focus,
  rubric,
  redFlags,
}: BuildModeParams): InterviewModeConfig {
  return {
    id,
    label,
    description,
    promptVersion: INTERVIEW_PROMPT_VERSION,
    persona: { name: persona, tone, pacing, reactsToWeakAnswers: weakAnswer },
    phases,
    questionStrategy: [...COMMON_RULES, focus],
    difficultyCalibration: {
      byLevel: LEVEL_DIFFICULTY,
      byRoleFamily: ROLE_FAMILY_DIFFICULTY,
    },
    rubric,
    redFlags,
    antiPatterns: [
      "No hints or coaching until the interview is complete.",
      "Never ask more than one question at a time.",
      "Never exceed two spoken-style sentences in a question.",
      "Never repeat a question or revisit a topic already covered.",
    ],
  };
}

export const INTERVIEW_MODE_CONFIGS = {
  hr: buildMode({
    id: "hr",
    label: "HR & fit",
    description: "Practice motivation, communication, collaboration, and role fit.",
    persona: "Alex",
    tone: "warm, curious, professional",
    pacing: "conversational with space for reflection",
    weakAnswer: "Invite one concrete example, then transition gently if details remain unclear.",
    phases: { intro: 10, resumeDeepDive: 25, modeSpecific: 35, candidateQuestions: 15, wrapUp: 15 },
    focus:
      "Explore motivation, career decisions, collaboration, conflict, and values aligned to the job.",
    rubric: [
      dimension(
        "communication",
        0.2,
        "Hard to follow; no direct answer.",
        "Clear answer with understandable reasoning.",
        "Exceptionally clear, concise, and audience-aware.",
      ),
      dimension(
        "motivation",
        0.2,
        "Motivation is absent or unrelated.",
        "Reasonable interest connected to the role.",
        "Specific, credible motivation tied to impact and fit.",
      ),
      dimension(
        "collaboration",
        0.2,
        "No ownership or constructive teamwork evidence.",
        "Shows a workable team contribution.",
        "Builds trust and resolves differences with strong judgment.",
      ),
      dimension(
        "evidence",
        0.2,
        "Claims without examples.",
        "Relevant example with some detail.",
        "Specific, verifiable example and outcome.",
      ),
      dimension(
        "self_awareness",
        0.2,
        "No reflection or learning.",
        "Identifies a lesson or development area.",
        "Candid reflection with clear behavior change.",
      ),
    ],
    redFlags: [
      "Contradicting resume facts",
      "Blaming others without personal reflection",
      "No concrete examples",
    ],
  }),
  founder: buildMode({
    id: "founder",
    label: "Founder conversation",
    description: "Practice ownership, ambiguity, speed, resourcefulness, and pushback.",
    persona: "Morgan",
    tone: "direct, energetic, respectful",
    pacing: "fast-moving with focused follow-ups",
    weakAnswer: "Ask once for the candidate's own decision and action, then move forward.",
    phases: { intro: 5, resumeDeepDive: 25, modeSpecific: 45, candidateQuestions: 10, wrapUp: 15 },
    focus:
      "Use real resume outcomes to probe ownership, speed, limited resources, mistakes, and respectful pushback under ambiguity.",
    rubric: [
      dimension(
        "ownership",
        0.24,
        "Avoids accountability or cannot name a personal action.",
        "Owns a scoped result and explains decisions.",
        "Takes end-to-end accountability and compounds team impact.",
      ),
      dimension(
        "speed",
        0.18,
        "Waits for certainty or stalls.",
        "Balances urgency with reasonable quality.",
        "Creates fast learning loops without ignoring critical risk.",
      ),
      dimension(
        "resourcefulness",
        0.2,
        "Cannot adapt when resources are constrained.",
        "Finds a practical workaround.",
        "Reframes constraints into leverage and measurable progress.",
      ),
      dimension(
        "judgment",
        0.2,
        "Tradeoffs and consequences are missing.",
        "Explains a sensible tradeoff.",
        "Makes a high-quality decision under ambiguity and revisits it with evidence.",
      ),
      dimension(
        "pushback_handling",
        0.18,
        "Avoids disagreement or becomes defensive.",
        "Explains disagreement respectfully.",
        "Uses evidence to challenge constructively and commits after a decision.",
      ),
    ],
    redFlags: [
      "Inflated ownership",
      "Blaming without learning",
      "Speed claims with no quality or outcome evidence",
    ],
  }),
  technical: buildMode({
    id: "technical",
    label: "Technical",
    description: "Practice role-specific problem solving, correctness, depth, and tradeoffs.",
    persona: "Taylor",
    tone: "curious, precise, collaborative",
    pacing: "one progressively deeper probe at a time",
    weakAnswer:
      "Ask for the candidate's reasoning or a concrete debugging example, then continue without coaching.",
    phases: { intro: 5, resumeDeepDive: 30, modeSpecific: 45, candidateQuestions: 10, wrapUp: 10 },
    focus:
      "Calibrate to the role family: engineering covers design/reliability/debugging; data covers methods/quality; design covers research/accessibility; product covers prioritization and outcomes.",
    rubric: [
      dimension(
        "correctness",
        0.25,
        "Core concepts or proposed solution are incorrect.",
        "Mostly correct with minor gaps.",
        "Correct, robust, and attentive to edge cases.",
      ),
      dimension(
        "depth",
        0.2,
        "Cannot explain why the approach works.",
        "Explains core reasoning and implementation.",
        "Reasons from fundamentals and anticipates failure modes.",
      ),
      dimension(
        "tradeoffs",
        0.2,
        "Ignores alternatives and costs.",
        "Names a relevant tradeoff.",
        "Compares alternatives with context-specific constraints.",
      ),
      dimension(
        "problem_solving",
        0.2,
        "No structured path or validation.",
        "Uses a sensible approach and checks results.",
        "Breaks ambiguity into testable steps and validates assumptions.",
      ),
      dimension(
        "communication",
        0.15,
        "Reasoning is difficult to follow.",
        "Explains the approach clearly.",
        "Makes complex reasoning precise and easy to follow.",
      ),
    ],
    redFlags: [
      "Confident claims without verification",
      "Resume contradictions",
      "Ignoring safety, reliability, or data quality",
    ],
  }),
  behavioral: buildMode({
    id: "behavioral",
    label: "Behavioral",
    description: "Practice evidence-rich stories about ownership, change, and results.",
    persona: "Jordan",
    tone: "patient, attentive, non-judgmental",
    pacing: "give time for a complete example, then probe one gap",
    weakAnswer: "Ask one focused follow-up on the missing situation, personal action, or result.",
    phases: { intro: 5, resumeDeepDive: 30, modeSpecific: 40, candidateQuestions: 10, wrapUp: 15 },
    focus:
      "Build questions around distinct STAR examples and probe situation, task, personal action, and measurable result without supplying answers.",
    rubric: [
      dimension(
        "situation_task",
        0.2,
        "Context and responsibility are unclear.",
        "Context and task are understandable.",
        "Sets concise context and a precise personal responsibility.",
      ),
      dimension(
        "personal_action",
        0.25,
        "Actions are absent or only described as 'we'.",
        "Explains personal actions and reasoning.",
        "Shows decisive, well-reasoned actions and ownership.",
      ),
      dimension(
        "result",
        0.2,
        "No outcome or learning.",
        "Provides a relevant outcome.",
        "Quantifies impact and explains attribution honestly.",
      ),
      dimension(
        "reflection",
        0.2,
        "No learning or accountability.",
        "Identifies a lesson.",
        "Shows candid reflection and durable behavior change.",
      ),
      dimension(
        "communication",
        0.15,
        "Story is disorganized or unfocused.",
        "Story is mostly clear and relevant.",
        "Story is concise, coherent, and highly relevant.",
      ),
    ],
    redFlags: ["Contradictory facts", "No personal contribution", "Blame without accountability"],
  }),
  aptitude_case: buildMode({
    id: "aptitude_case",
    label: "Aptitude & case",
    description: "Practice structured cases, quantitative reasoning, and clear assumptions.",
    persona: "Casey",
    tone: "analytical, encouraging, neutral",
    pacing: "share one problem at a time and let the candidate lead",
    weakAnswer:
      "Ask the candidate to state assumptions and next reasoning step; do not hint at the solution.",
    phases: { intro: 5, resumeDeepDive: 10, modeSpecific: 65, candidateQuestions: 10, wrapUp: 10 },
    focus:
      "Use role-appropriate estimation, prioritization, or business cases; assess stated assumptions, units, decomposition, and answer sanity checks.",
    rubric: [
      dimension(
        "structure",
        0.25,
        "Jumps to an answer without a method.",
        "Uses a workable structure.",
        "Builds a crisp, complete structure from the objective.",
      ),
      dimension(
        "assumptions",
        0.2,
        "Assumptions are hidden or implausible.",
        "States reasonable assumptions.",
        "Chooses and validates high-impact assumptions.",
      ),
      dimension(
        "quantitative_reasoning",
        0.25,
        "Calculation or units are materially wrong.",
        "Mostly correct with transparent steps.",
        "Accurate, efficient calculations with sanity checks.",
      ),
      dimension(
        "insight",
        0.15,
        "Does not interpret the result.",
        "Connects result to a basic implication.",
        "Extracts a relevant, nuanced implication and next step.",
      ),
      dimension(
        "communication",
        0.15,
        "Reasoning is difficult to follow.",
        "Explains steps clearly.",
        "Keeps a complex solution concise and legible.",
      ),
    ],
    redFlags: [
      "Unstated assumptions",
      "No unit checks",
      "Changing an answer without acknowledging new evidence",
    ],
  }),
};

export const INTERVIEW_MODES = Object.values(INTERVIEW_MODE_CONFIGS).map(
  ({ id, label, description, promptVersion }) => ({ id, label, description, promptVersion }),
);

export const INTERVIEW_TRANSITIONS: Record<string, string[]> = {
  ready: ["in_progress", "cancelled"],
  in_progress: ["completed", "expired", "cancelled"],
  completed: [],
  expired: [],
  cancelled: [],
};

export function canTransitionInterview(from: string, to: string): boolean {
  return INTERVIEW_TRANSITIONS[from]?.includes(to) ?? false;
}
