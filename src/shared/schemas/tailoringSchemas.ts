import { z } from "zod";

export const startTailoringSchema = z
  .object({
    jobId: z.string().min(1, "jobId is required"),
    jobTitle: z.string().min(1, "jobTitle is required"),
    company: z.string().min(1, "company is required"),
    jdText: z.string().optional().default(""),
  })
  .strict();

export type StartTailoringInput = z.infer<typeof startTailoringSchema>;

export const approveTailoringSchema = z
  .object({
    editedBullets: z
      .array(
        z.object({
          factId: z.string(),
          tailoredBullet: z.string(),
        }),
      )
      .optional(),
  })
  .strict();

export type ApproveTailoringInput = z.infer<typeof approveTailoringSchema>;

export const rejectTailoringSchema = z
  .object({
    reason: z.string().optional().default(""),
  })
  .strict();

export type RejectTailoringInput = z.infer<typeof rejectTailoringSchema>;
