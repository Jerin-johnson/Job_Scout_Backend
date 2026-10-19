import { z } from "zod";

export const prepSchema = z
  .object({
    jobTitle: z.string().min(1, "jobTitle is required"),
    company: z.string().min(1, "company is required"),
    jdText: z.string().max(12000).optional().default(""),
  })
  .strict();

export type PrepInput = z.infer<typeof prepSchema>;

export const mockTurnSchema = z
  .object({
    sessionId: z.string().max(128).optional(),
    questionId: z.string().min(1, "questionId is required").max(128),
    question: z.string().min(1, "question is required").max(1000),
    candidateAnswer: z.string().trim().min(1).max(4000),
  })
  .strict();

export type MockTurnInput = z.infer<typeof mockTurnSchema>;

export const createSessionSchema = z
  .object({
    resumeId: z.string().min(1),
    role: z.string().trim().min(1).max(160),
    level: z.enum(["fresher", "mid", "senior"]),
    mode: z.enum(["hr", "founder", "technical", "behavioral", "aptitude_case"]),
    durationMinutes: z.union([z.literal(10), z.literal(20), z.literal(30)]),
    jobDescription: z.string().max(12000).optional().default(""),
    consent: z.object({ accepted: z.literal(true), version: z.string().min(1) }),
  })
  .strict();

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const answerSchema = z
  .object({
    answer: z.string().trim().min(1).max(4000),
    source: z.enum(["text", "audio"]).optional().default("text"),
    audioDurationMs: z
      .number()
      .int()
      .nonnegative()
      .max(30 * 60 * 1000)
      .nullable()
      .optional(),
    startedAtMs: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

export type AnswerInput = z.infer<typeof answerSchema>;

export const completeSchema = z
  .object({ retryFallback: z.boolean().default(false) })
  .strict()
  .default({});

export type CompleteInput = z.infer<typeof completeSchema>;

export const pinSchema = z.object({ pinned: z.boolean() }).strict();
export type PinInput = z.infer<typeof pinSchema>;

export const emptySchema = z.object({}).strict().default({});

export const sessionQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type SessionQueryInput = z.infer<typeof sessionQuerySchema>;

export const startSchema = z
  .object({ timezone: z.string().trim().min(1).max(64).optional() })
  .strict()
  .default({});

export type StartInput = z.infer<typeof startSchema>;
