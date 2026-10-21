import { z } from "zod";

export const MAX_JOB_DESCRIPTION_CHARS = 20_000;

export const matchJobSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("catalog"), jobId: z.string().min(1).max(100) }).strict(),
  z
    .object({
      type: z.literal("application"),
      applicationId: z.string().regex(/^[a-f\d]{24}$/i),
      description: z.string().max(MAX_JOB_DESCRIPTION_CHARS).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("pasted"),
      title: z.string().trim().min(1).max(200),
      company: z.string().trim().max(200).default(""),
      description: z.string().trim().min(1).max(MAX_JOB_DESCRIPTION_CHARS),
    })
    .strict(),
]);

export const createResumeMatchSchema = z.preprocess(
  (val: unknown) => {
    if (val && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      const { target, ...rest } = obj;
      const job = rest.job || target;
      return { ...rest, job };
    }
    return val;
  },
  z
    .object({
      resumeId: z.string().regex(/^[a-f\d]{24}$/i),
      job: matchJobSchema,
    })
    .strict(),
);

export type CreateResumeMatchInput = {
  resumeId: string;
  job: z.infer<typeof matchJobSchema>;
};

export const ignoredKeywordSchema = z
  .object({
    keyword: z.string().trim().min(1).max(100),
    ignored: z.boolean().default(true),
  })
  .strict();

export type IgnoredKeywordInput = z.infer<typeof ignoredKeywordSchema>;
