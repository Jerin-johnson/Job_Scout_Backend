import test from "node:test";
import assert from "node:assert/strict";
import {
  generatePersonalizedQuizQuestions,
  hasQuizReadyResume,
  normalizeQuizSkills,
  stackQuizService,
  toPublicQuizQuestion,
} from "../src/infrastructure/interview/stackQuizService.js";
import { CacheKeys, set, TTL } from "../src/shared/cache.js";
import { QuizAttemptModel } from "../src/infrastructure/database/mongoose/models/QuizAttemptModel.js";

const generatedQuestion = (index) => ({
  type: index === 1 ? "scenario_voice" : "quick_mcq",
  title: `React question ${index}`,
  question: `How would you apply React concept ${index} in a real project?`,
  ...(index === 1
    ? { expectedKeyPoints: ["state updates", "render performance"] }
    : {
        options: ["One", "Two", "Three", "Four"],
        correctOptionIndex: 2,
      }),
  correctAnswerText: `A clear, technically accurate explanation for question ${index}.`,
  explanation: `This explains the React concept and why it works in question ${index}.`,
  difficulty: "mid",
});

test("personalized quiz generation requests a short pack using candidate skills and target roles", async () => {
  let call;
  const questions = [1, 2, 3].map(generatedQuestion);
  const result = await generatePersonalizedQuizQuestions(
    {
      stack: "react",
      count: 3,
      skills: [
        { factId: "f1", name: "React" },
        { factId: "f2", name: "TypeScript" },
      ],
      targetRoles: ["Frontend Engineer"],
      experience: ["UI Engineer"],
      user: { id: "quiz-test-user" },
    },
    async (options) => {
      call = options;
      return { questions };
    },
  );

  assert.equal(result.length, 3);
  assert.ok(result.every((question) => question.id.startsWith("quiz_")));
  assert.equal(call.feature, "interview_prep");
  assert.equal(call.tier, "small");
  assert.match(call.prompt[0].content, /untrusted data/);
  assert.match(call.prompt[1].content, /Frontend Engineer/);
  assert.match(call.prompt[1].content, /Question count: 3/);
  assert.match(call.prompt[1].content, /React/);
});

test("structured resume skill facts are normalized and require a parsed resume with usable facts", () => {
  assert.deepEqual(normalizeQuizSkills([{ name: " React " }, { name: "TypeScript" }, "Node.js"]), [
    "React",
    "TypeScript",
    "Node.js",
  ]);
  assert.equal(
    hasQuizReadyResume(
      { parsedFactsCount: 0, factsSummary: { skills: 0, roles: 0 } },
      ["React"],
      [],
    ),
    false,
  );
  assert.equal(
    hasQuizReadyResume({ parsedFactsCount: 2, factsSummary: { skills: 2, roles: 0 } }, [], []),
    false,
  );
  assert.equal(
    hasQuizReadyResume(
      { parsedFactsCount: 2, factsSummary: { skills: 2, roles: 0 } },
      ["React"],
      [],
    ),
    true,
  );
});

test("personalized generation rejects a question repeated from recent quiz history", async () => {
  await assert.rejects(
    generatePersonalizedQuizQuestions(
      {
        stack: "Frontend Engineer",
        count: 3,
        skills: [{ name: "React" }],
        targetRoles: ["Frontend Engineer"],
        experience: [],
        previousQuestions: ["How would you apply React concept 1 in a real project?"],
      },
      async () => ({ questions: [1, 2, 3].map(generatedQuestion) }),
    ),
    /repeated a recent question/,
  );
});

test("personalized quiz generation passes its cancellation signal to the shared provider", async () => {
  const controller = new AbortController();
  let receivedSignal;
  await generatePersonalizedQuizQuestions(
    {
      stack: "react",
      count: 3,
      skills: [],
      targetRoles: [],
      experience: [],
      signal: controller.signal,
    },
    async (options) => {
      receivedSignal = options.signal;
      return { questions: [1, 2, 3].map(generatedQuestion) };
    },
  );
  assert.equal(receivedSignal, controller.signal);
});

test("personalized quiz generation rejects question packs outside the 3–5 question range", async () => {
  await assert.rejects(
    generatePersonalizedQuizQuestions(
      { stack: "react", count: 6, skills: [], targetRoles: [], experience: [] },
      async () => ({ questions: [] }),
    ),
    /between three and five/,
  );
});

test("question responses hide the answer key and rubric until evaluation", async () => {
  const [question] = await generatePersonalizedQuizQuestions(
    {
      stack: "react",
      count: 3,
      skills: [],
      targetRoles: [],
      experience: [],
    },
    async () => ({ questions: [1, 2, 3].map(generatedQuestion) }),
  );
  const visible = toPublicQuizQuestion(question);

  assert.equal(Object.hasOwn(visible, "correctOptionIndex"), false);
  assert.equal(Object.hasOwn(visible, "correctAnswerText"), false);
  assert.equal(Object.hasOwn(visible, "expectedKeyPoints"), false);
  assert.equal(Object.hasOwn(visible, "explanation"), false);
});

test("durable quiz history schema stores bounded owner-scoped attempts and submitted answers", () => {
  assert.ok(QuizAttemptModel.schema.path("userId"));
  assert.ok(QuizAttemptModel.schema.path("quizSessionId"));
  assert.ok(QuizAttemptModel.schema.path("questions"));
  const indexes = QuizAttemptModel.schema.indexes();
  assert.ok(
    indexes.some(
      ([keys, options]) => keys.userId === 1 && keys.quizSessionId === 1 && options.unique,
    ),
  );
  assert.ok(indexes.some(([keys]) => keys.userId === 1 && keys.createdAt === -1));
  assert.equal(
    QuizAttemptModel.schema.path("questions").caster.schema.path("userAnswer").options.maxlength,
    4000,
  );
  assert.ok(QuizAttemptModel.schema.path("questions").caster.schema.path("expectedKeyPoints"));
});

test("an incorrect scenario answer receives its reference answer and duplicate submission is not re-awarded", async () => {
  const userId = "quiz-personalization-test-user";
  const quizSessionId = "quiz-personalization-test-session";
  const question = {
    id: "quiz_test_scenario",
    stack: "react",
    type: "scenario_voice",
    title: "React rendering",
    question: "How would you diagnose slow rendering in a React application?",
    expectedKeyPoints: ["profile component renders", "memoize expensive calculations"],
    correctAnswerText:
      "Profile the component tree and memoize only measured expensive calculations.",
    explanation: "Measure first so optimization targets the actual rendering bottleneck.",
    pointsReward: 25,
    difficulty: "mid",
    voicePromptText: "How would you diagnose slow rendering?",
  };
  await set(
    CacheKeys.quizSession(userId, quizSessionId),
    { questions: [question], answeredQuestionIds: [], evaluations: {}, promptVersion: "test" },
    TTL.QUIZ_SESSION,
  );

  const answer = {
    userId,
    quizSessionId,
    questionId: question.id,
    stack: question.stack,
    userAnswer: "I would wait and try again later.",
  };
  const first = await stackQuizService.submitAnswer(answer);
  const retry = await stackQuizService.submitAnswer(answer);

  assert.equal(first.isCorrect, false);
  assert.match(first.correctAnswerText, /Profile the component tree/);
  assert.deepEqual(retry, first);
});
